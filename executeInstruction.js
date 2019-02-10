const decodeRoutine = require('./decodeRoutine');
const decodeVariable = require('./decodeVariable');
const performBranch = require('./performBranch');
const performStore = require('./performStore');
const performReturn = require('./performReturn');
const performDereference = require('./performDereference');
const unpackAddress = require('./unpackAddress');
const { getVersion } = require('./header');
const { read16, write16 } = require('./rw16');
const {
	RELATION_PARENT,
	RELATION_SIBLING,
	RELATION_CHILD,
	getDefaultProperty,
	getObjectAttribute,
	setObjectAttribute,
	getObjectRelation,
	setObjectRelation,
	getObjectPropertiesAddress
} = require('./object');
const decodePropertyTable = require('./decodePropertyTable');

module.exports = function executeInstruction(state, instruction, operands, output, input) {
	const op = instruction.opcode.op;
	switch (op) {
		case 'add': {
			/* add
				2OP:20 14 add a b -> (result)
				Signed 16-bit addition. */
			const value = (operands[0] + operands[1]) & 0xFFFF;
			performStore(state, instruction.resultVariable, value);
		} break;

		case 'and': {
			/* and
				2OP:9 9 and a b -> (result)
				Bitwise AND. */
			const value = operands[0] & operands[1];
			performStore(state, instruction.resultVariable, value);
		} break;

		case 'call': {
			/* call
				VAR:224 0 1 call routine ...up to 3 args... -> (result)
				The only call instruction in Version 3, Inform reads this as call_vs in higher versions: it calls the
				routine with 0, 1, 2 or 3 arguments as supplied and stores the resulting return value. (When the
				address 0 is called as a routine, nothing happens and the return value is false.) */
			const [packedAddress, ...args] = operands;

			if (packedAddress === 0) {
				performStore(state, instruction.resultVariable, 0);
			} else {
				const address = unpackAddress(state, op, packedAddress);
				const { localVariables, firstInstructionAddress } = decodeRoutine(state, address);

				args.forEach((arg, i) => {
					if (localVariables.length > i) {
						localVariables[i] = args[i];
					}
				});

				const stackFrame = {
					stack: [],
					localVariables,
					resultVariable: instruction.resultVariable,
					nextAddress: state.pc
				};
				state.stack.push(stackFrame);
				state.pc = firstInstructionAddress;
			}

		} break;

		case 'get_child': {
			/* get_child
				1OP:130 2 get_child object -> (result) ?(label)
				Get first object contained in given object, branching if this exists, i.e. is not nothing (i.e., is not
				0). */
			const child = getObjectRelation(state, operands[0], RELATION_CHILD);
			performStore(state, instruction.resultVariable, child);

			const test = child !== 0;
			if (test === instruction.branchIf) {
				performBranch(state, instruction.branchOffset);
			}
		} break;

		case 'get_parent': {
			/* get_parent
				1OP:131 3 get_parent object -> (result)
				Get parent object (note that this has no "branch if exists" clause). */
			const parent = getObjectRelation(state, operands[0], RELATION_PARENT);
			performStore(state, instruction.resultVariable, parent);
		} break;

		case 'get_prop': {
			/* get_prop
				2OP:17 11 get_prop object property -> (result)
				Read property from object (resulting in the default value if it had no such declared property). If
				the property has length 1, the value is only that byte. If it has length 2, the first two bytes of the
				property are taken as a word value. It is illegal for the opcode to be used if the property has
				length greater than 2, and the result is unspecified. */
			const propertyTableAddress = getObjectPropertiesAddress(state, operands[0]);
			const propertyTable = decodePropertyTable(state, propertyTableAddress);
			const property = propertyTable.properties.find(entry => entry.number === operands[1]);
			if (property) {
				performStore(state, instruction.resultVariable,
					property.data.length === 1 ?
						property.data[0] :
						read16(property.data, 0));
			} else {
				performStore(state, instruction.resultVariable, getDefaultProperty(state, operands[1]));
			}
		} break;

		case 'get_prop_addr': {
			/* get_prop_addr
				2OP:18 12 get_prop_addr object property -> (result)
				Get the byte address (in dynamic memory) of the property data for the given object's property.
				This must return 0 if the object hasn't got the property. */
			const propertyTableAddress = getObjectPropertiesAddress(operands[0]);
			const propertyTable = decodePropertyTable(state, propertyTableAddress);
			const property = propertyTable.properties.find(entry => entry.number === operands[1]);
			if (property) {
				performStore(state, instruction.resultVariable, property.address);
			} else {
				performStore(state, instruction.resultVariable, 0);
			}
		} break;

		case 'get_sibling': {
			/* get_sibling
				1OP:129 1 get_sibling object -> (result) ?(label)
				Get next object in tree, branching if this exists, i.e. is not 0. */
			const sibling = getObjectRelation(state, operands[0], RELATION_SIBLING);
			performStore(state, instruction.resultVariable, sibling);

			const test = sibling !== 0;
			if (test === instruction.branchIf) {
				performBranch(state, instruction.branchOffset);
			}
		} break;

		case 'inc': {
			/* inc
				1OP:133 5 inc (variable)
				Increment variable by 1. (This is signed, so -1 increments to 0.) */
			const variable = decodeVariable(operands[0]);
			let value = performDereference(state, variable);
			value = (value + 1) & 0xFFFF;
			performStore(state, variable, value);
		} break;

		case 'inc_chk': {
			/* inc_chk
				2OP:5 5 inc_chk (variable) value ?(label)
				Increment variable, and branch if now greater than value. */
			const variable = decodeVariable(operands[0]);
			let value = performDereference(state, variable);
			value = (value + 1) & 0xFFFF;
			performStore(state, variable, value);

			const test = value > operands[1];
			if (test === instruction.branchIf) {
				performBranch(state, instruction.branchOffset);
			}
		} break;

		case 'insert_obj': {
			/* insert_obj
				2OP:14 E insert_obj object destination
				Moves object O to become the first child of the destination object D. (Thus, after the operation
				the child of D is O, and the sibling of O is whatever was previously the child of D.) All children
				of O move with it. (Initially O can be at any point in the object tree; it may legally have parent
				zero.) */
			const [obj, dest] = operands;
			const objParent = getObjectRelation(state, obj, RELATION_PARENT);
			const objSibling = getObjectRelation(state, obj, RELATION_SIBLING);
			const destChild = getObjectRelation(state, dest, RELATION_CHILD);

			if (objParent !== 0) {
				let node = getObjectRelation(state, objParent, RELATION_CHILD);
				if (node === obj) {
					setObjectRelation(state, objParent, RELATION_CHILD, objSibling);
				} else {
					let nodeSibling;
					while (nodeSibling !== obj) {
						node = nodeSibling;
						nodeSibling = getObjectRelation(state, node, RELATION_SIBLING);
					}
					setObjectRelation(state, node, RELATION_SIBLING, objSibling);
				}
			}
			setObjectRelation(state, dest, RELATION_CHILD, obj);
			setObjectRelation(state, obj, RELATION_PARENT, dest);
			setObjectRelation(state, obj, RELATION_SIBLING, destChild);
		} break;

		case 'je': {
			/* je
				2OP:1 1 je a b ?(label)
				Jump if a is equal to any of the subsequent operands. (Thus @je a never jumps and @je a b
				jumps if a = b.) */
			const test = operands.slice(1).some(op => operands[0] === op);
			if (test === instruction.branchIf) {
				performBranch(state, instruction.branchOffset);
			}
		} break;

		case 'jg': {
			/* jg
				2OP:3 3 jg a b ?(label)
				Jump if a > b (using a signed 16-bit comparison). */
			const signedOperands = new Int16Array(operands);
			const test = signedOperands[0] > signedOperands[1];
			if (test === instruction.branchIf) {
				performBranch(state, instruction.branchOffset);
			}
		} break;

		case 'jin': {
			/* jin
				2OP:6 6 jin obj1 obj2 ?(label)
				Jump if object a is a direct child of b, i.e., if parent of a is b. */
			const test = getObjectRelation(state, operands[0], RELATION_PARENT) === operands[1];
			if (test === instruction.branchIf) {
				performBranch(state, instruction.branchOffset);
			}
		} break;

		case 'jl': {
			/* jl
				2OP:2 2 jl a b ?(label)
				Jump if a < b (using a signed 16-bit comparison). */
			const signedOperands = new Int16Array(operands);
			const test = signedOperands[0] < signedOperands[1];
			if (test === instruction.branchIf) {
				performBranch(state, instruction.branchOffset);
			}
		} break;

		case 'jump': {
			/* jump
				1OP:140 C jump ?(label)
				Jump (unconditionally) to the given label. (This is not a branch instruction and the operand is a
				2-byte signed offset to apply to the program counter.) It is legal for this to jump into a different
				routine (which should not change the routine call state), although it is considered bad practice to
				do so and the Txd disassembler is confused by it. */
			performBranch(state, operands[0]);
		}

		case 'jz': {
			/* jz
				1OP:128 0 jz a ?(label)
				Jump if a = 0. */
			const test = operands[0] === 0;
			if (test === instruction.branchIf) {
				performBranch(state, instruction.branchOffset);
			}
		} break;

		case 'loadb': {
			/* loadb
				2OP:16 10 loadb array byte-index -> (result)
				Stores array->byte-index (i.e., the byte at address array+byte-index, which must lie in static or
				dynamic memory). */
			const value = state.memory[operands[0] + 2*operands[1]];
			performStore(state, instruction.resultVariable, value);
		} break;

		case 'loadw': {
			/* loadw
				2OP:15 F loadw array word-index -> (result)
				Stores array-->word-index (i.e., the word at address array+2*word-index, which must lie in
				static or dynamic memory). */
			const value = read16(state.memory, operands[0] + 2*operands[1]);
			performStore(state, instruction.resultVariable, value);
		} break;

		case 'new_line': {
			/* new_line
				0OP:187 B new_line
				Print carriage return. */
			output.text += '\n';
		} break;

		case 'or': {
			/* or
				2OP:8 8 or a b -> (result)
				Bitwise OR. */
			const value = operands[0] | operands[1];
			performStore(state, instruction.resultVariable, value);
		} break;

		case 'print': {
			/* print
				0OP:178 2 print
				Print the quoted (literal) Z-encoded string. */
			output.text += instruction.text;
		} break;

		case 'print_char': {
			/* print_char
				VAR:229 5 print_char output-character-code
				Print a ZSCII character. The operand must be a character code defined in ZSCII for output (see S
				3). In particular, it must certainly not be negative or larger than 1023. */
			output.text += String.fromCharCode(operands[0]);
		} break;

		case 'print_num': {
			/* print_num
				VAR:230 6 print_num value
				Print (signed) number in decimal. */
			const value = new Int16Array([operands[0]])[0];
			output.text += value.toString(10);
		} break;

		case 'print_obj': {
			/* print_obj
				1OP:138 A print_obj object
				Print short name of object (the Z-encoded string in the object header, not a property). If the object
				number is invalid, the interpreter should halt with a suitable error message. */
			const propertyTableAddress = getObjectPropertiesAddress(state, operands[0]);
			const propertyTable = decodePropertyTable(state, propertyTableAddress);
			output.text += propertyTable.shortName;
		} break;

		case 'pull': {
			/* pull
				VAR:233 9 1 pull (variable)
				6 pull stack -> (result)
				Pulls value off a stack. (If the stack underflows, the interpreter should halt with a suitable error
				message.) In Version 6, the stack in question may be specified as a user one: otherwise it is the
				game stack. */
			const frame = state.stack[state.stack.length - 1];
			const variable = decodeVariable(operands[0]);
			const value = frame.stack.pop();
			performStore(state, variable, value);
		} break;

		case 'push': {
			/* push
				VAR:232 8 push value
				Pushes value onto the game stack. */
			const frame = state.stack[state.stack.length - 1];
			frame.stack.push(operands[0]);
		} break;

		case 'put_prop': {
			/* put_prop
				VAR:227 3 put_prop object property value
				Writes the given value to the given property of the given object. If the property does not exist for
				that object, the interpreter should halt with a suitable error message. If the property length is 1,
				then the interpreter should store only the least significant byte of the value. (For instance, storing
				-1 into a 1-byte property results in the property value 255.) As with get_prop the property length
				must not be more than 2: if it is, the behaviour of the opcode is undefined. */
			const propertyTableAddress = getObjectPropertiesAddress(state, operands[0]);
			const propertyTable = decodePropertyTable(state, propertyTableAddress);
			const property = propertyTable.properties.find(property => property.number === operands[1]);
			if (!property) {
				throw new Error(`property ${operands[1]} does not exist on object ${operands[0]}`);
			}
			if (property.length === 1) {
				property.data[0] = operands[2] & 0xFF;
			} else {
				// NOTE: if property length is more than 2, behavior is undefined.
				// Here we just leave the extra data without overwriting it.
				write16(property.data, 0, operands[2]);
			}
		} break;

		case 'read': {
			/* read
				VAR:228 4 1 sread text parse
				4 sread text parse time routine
				5 aread text parse time routine -> (result)
				(Note that Inform internally names the read opcode as aread in Versions 5 and later and sread
				in Versions 3 and 4.)
				This opcode reads a whole command from the keyboard (no prompt is automatically displayed).
				It is legal for this to be called with the cursor at any position on any window.
				In Versions 1 to 3, the status line is automatically redisplayed first.
				A sequence of characters is read in from the current input stream until a carriage return (or, in
				Versions 5 and later, any terminating character) is found.
				In Versions 1 to 4, byte 0 of the text-buffer should initially contain the maximum number of
				letters which can be typed, minus 1 (the interpreter should not accept more than this). The text
				typed is reduced to lower case (so that it can tidily be printed back by the program if need be)
				and stored in bytes 1 onward, with a zero terminator (but without any other terminator, such as a
				carriage return code). (This means that if byte 0 contains n then the buffer must contain n+1
				bytes, which makes it a string array of length n in Inform terminology.)
				In Versions 5 and later, byte 0 of the text-buffer should initially contain the maximum number
				of letters which can be typed (the interpreter should not accept more than this). The interpreter
				stores the number of characters actually typed in byte 1 (not counting the terminating character),
				and the characters themselves in bytes 2 onward (not storing the terminating character). (Some
				interpreters wrongly add a zero byte after the text anyway, so it is wise for the buffer to contain
				at least n+3 bytes.)
				Moreover, if byte 1 contains a positive value at the start of the input, then read assumes that
				number of characters are left over from an interrupted previous input, and writes the new characters
				after those already there. Note that the interpreter does not redisplay the characters left
				over: the game does this, if it wants to. This is unfortunate for any interpreter wanting to give input
				text a distinctive appearance on-screen, but 'Beyond Zork', 'Zork Zero' and 'Shogun' clearly
				require it. ("Just a tremendous pain in my butt" -- Andrew Plotkin; "the most unfortunate feature
				of the Z-machine design" -- Stefan Jokisch.)
				In Version 4 and later, if the operands time and routine are supplied (and non-zero) then the
				routine call routine() is made every time/10 seconds during the keyboard-reading process. If this
				routine returns true, all input is erased (to zero) and the reading process is terminated at once.
				(The terminating character code is 0.) The routine is permitted to print to the screen even if it
				returns false to signal "carry on": the interpreter should notice and redraw the input line so far,
				before input continues. (Frotz notices by looking to see if the cursor position is at the left-hand
				margin after the interrupt routine has returned.)
				If input was terminated in the usual way, by the player typing a carriage return, then a carriage
				return is printed (so the cursor moves to the next line). If it was interrupted, the cursor is left at
				the rightmost end of the text typed in so far.
				Next, lexical analysis is performed on the text (except that in Versions 5 and later, if parsebuffer
				is zero then this is omitted). Initially, byte 0 of the parse-buffer should hold the maximum
				number of textual words which can be parsed. (If this is n, the buffer must be at least 2 +
				4*n bytes long to hold the results of the analysis.)
				The interpreter divides the text into words and looks them up in the dictionary, as described in S
				13. The number of words is written in byte 1 and one 4-byte block is written for each word, from
				byte 2 onwards (except that it should stop before going beyond the maximum number of words
				specified). Each block consists of the byte address of the word in the dictionary, if it is in the
				dictionary, or 0 if it isn't; followed by a byte giving the number of letters in the word; and finally
				a byte giving the position in the text-buffer of the first letter of the word.
				In Version 5 and later, this is a store instruction: the return value is the terminating character
				(note that the user pressing his "enter" key may cause either 10 or 13 to be returned; the author
				recommends that interpreters return 10). A timed-out input returns 0.
				(Versions 1 and 2 and early Version 3 games mistakenly write the parse buffer length 240 into
				byte 0 of the parse buffer: later games fix this bug and write 59, because 2+4*59 = 238 so that 59
				is the maximum number of textual words which can be parsed into a buffer of length 240 bytes.
				Old versions of the Inform 5 library commit the same error. Neither mistake has very serious
				consequences.)
				(Interpreters are asked to halt with a suitable error message if the text or parse buffers have
				length of less than 3 or 6 bytes, respectively: this sometimes occurs due to a previous array being
				overrun, causing bugs which are very difficult to find.) */
			const maxInputLength = state.memory[operands[0]] - (getVersion(state) <= 4 ? 1 : 0);
			input = input.toLowerCase().replace(/\n.*/g, '').slice(0, maxInputLength);

			let address = operands[0] + (getVersion(state) <= 4 ? 1 : 2);
			for (let i = 0; i < input.length; ++i) {
				state.memory[address++] = input.charCodeAt(i);
			}
			if (getVersion(state) <= 4) {
				state.memory[address++] = 0;
			}

			throw new Error('UNIMPLEMENTED');
		} break;

		case 'ret': {
			/* ret
				1OP:139 B ret value
				Returns from the current routine with the value given. */
			performReturn(state, operands[0]);
		} break;

		case 'ret_popped': {
			/* ret_popped
				0OP:184 8 ret_popped
				Pops top of stack and returns that. (This is equivalent to ret sp, but is one byte cheaper.) */
			performReturn(state, performDereference(state, { type: 'stack' }));
		} break;

		case 'rfalse': {
			/* rfalse
				0OP:177 1 rfalse
				Return false (i.e., 0) from the current routine. */
			performReturn(state, 0);
		} break;

		case 'rtrue': {
			/* rtrue
				0OP:176 0 rtrue
				Return true (i.e., 1) from the current routine. */
			performReturn(state, 1);
		} break;

		case 'set_attr': {
			/* set_attr
				2OP:11 B set_attr object attribute
				Make object have the attribute numbered attribute. */
			setObjectAttribute(state, operands[0], operands[1]);
		} break;

		case 'store': {
			/* store
				2OP:13 D store (variable) value
				Set the VARiable referenced by the operand to value. */
			const variable = decodeVariable(operands[0]);
			performStore(state, variable, operands[1]);
		} break;

		case 'storeb': {
			/* storeb
				VAR:226 2 storeb array byte-index value
				array->byte-index = value, i.e. stores the given value in the byte at address array+byte-index
				(which must lie in dynamic memory). (See loadb.) */
			const address = operands[0] + 2*operands[1];
			state.memory[address] = operands[2];
		} break;

		case 'storew': {
			/* storew
				VAR:225 1 storew array word-index value
				array-->word-index = value, i.e. stores the given value in the word at address array+2*wordindex
				(which must lie in dynamic memory). (See loadw.) */
			const address = operands[0] + 2*operands[1];
			write16(state.memory, address, operands[2]);
		} break;

		case 'sub': {
			/* sub
				2OP:21 15 sub a b -> (result)
				Signed 16-bit subtraction. */
			const value = (operands[0] - operands[1]) & 0xFFFF;
			performStore(state, instruction.resultVariable, value);
		} break;

		case 'test': {
			/* test
				2OP:7 7 test bitmap flags ?(label)
				Jump if all of the flags in bitmap are set (i.e. if bitmap & flags == flags). */
			const test = operands[0] & operands[1] === operands[1];
			if (test === instruction.branchIf) {
				performBranch(state, instruction.branchOffset);
			}
		} break;

		case 'test_attr': {
			/* test_attr
				2OP:10 A test_attr object attribute ?(label)
				Jump if object has attribute. */
			const test = getObjectAttribute(state, operands[0], operands[1]);
			if (test === instruction.branchIf) {
				performBranch(state, instruction.branchOffset);
			}
		} break;

		default: {
			throw new Error(`unimplemented opcode ${op}`);
		}
	}

	return false;
}
