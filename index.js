const TYPE_LARGE_CONSTANT = 0x0;
const TYPE_SMALL_CONSTANT = 0x1;
const TYPE_VARIABLE = 0x2;
const TYPE_OMITTED = 0x3;

let DEBUG = true;

const debuglog = function() {
	if (DEBUG) {
		console.log.apply(console, arguments);
	}
}

const getOpcodeTable = require('./getOpcodeTable');
function lookupOpcode(version, operandCount, opcode) {
	const opcodeTable = getOpcodeTable(version);
	return opcodeTable.find(entry => entry.code === opcode && entry.operandCount === operandCount);
}

test();

function test() {
	const fs = require('fs');
	const readline = require('readline');
	const rl = readline.createInterface({
		input: process.stdin,
		output: process.stdout
	});
	const file = fs.readFileSync(process.argv[2] || './stories/zork1.z3');
	const state = initFromBuffer(file.buffer);
	main(rl, state);
}

function initFromBuffer(buffer) {
	const memory = new Uint8Array(buffer);
	const header = defineHeader(buffer);
	const objectTable = defineObjectTable(buffer, header);

	return {
		buffer,
		memory,
		header,
		objectTable,
		stack: [
			{ stack: [] }
		],
		pc: header.initialProgramCounter
	};
}

function main(rl, state) {
	let result;
	while (true) {
		result = run(state);
		if (result) {
			break;
		}
	}

	if (result.yield) {
		rl.question('', line => {
			switch(result.instruction.opcode.op) {
				case 'read': {
					const maxInputLength = state.header.version <= 4 ?
						state.memory[result.operands[0]] - 1 :
						state.memory[result.operands[0]];
					line = line.toLowerCase().replace(/\n.*/g, '').slice(0, maxInputLength)
					const view = new DataView(state.buffer,
						state.header.version <= 4 ?
							result.operands[0] + 1 :
							result.operands[0] + 2,
						state.header.version <= 4 ?
							maxInputLength + 1 :
							maxInputLength);
					console.log(Buffer.from(line, 'ascii'));
					for (let i = 0; i < line.length; ++i) {
						view.setUint8(i, line.charCodeAt(i));
					}
					if (state.header.version <= 4) {
						view.setUint8(line.length, 0);
					}

					throw new Error('TODO');
				} break;

				default:
					throw new Error(`unexpected yielded opcode ${result.instruction.opcode.op}`);
			}

			main(rl, state);
		});
	}
}

function run(state) {
	const instruction = decodeInstruction(state, state.pc);
	if (!instruction.opcode) {
		throw new Error(`invalid instruction at 0x${state.pc.toString(16)}`);
	}
	debuglog(instructionToString(instruction));
	const operands = instruction.operands.map(op => performDereference(state, op));
	debuglog('        [' + operands.map(op => op.toString(16).padStart(4, 0)).join(' ') + ']');
	debuglog(state.stack);

	state.pc = instruction.nextAddress;

	switch (instruction.opcode.op) {
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
				const address = unpackAddress(state, instruction.opcode.op, packedAddress);
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
			const obj = state.objectTable.getObject(operands[0]);
			performStore(state, instruction.resultVariable, obj.child);

			const test = obj.child !== 0;
			if (test === instruction.branchIf) {
				performBranch(state, instruction.branchOffset);
			}
		} break;

		case 'get_parent': {
			/* get_parent
				1OP:131 3 get_parent object -> (result)
				Get parent object (note that this has no "branch if exists" clause). */
			const obj = state.objectTable.getObject(operands[0]);
			performStore(state, instruction.resultVariable, obj.parent);
		} break;

		case 'get_prop': {
			/* get_prop
				2OP:17 11 get_prop object property -> (result)
				Read property from object (resulting in the default value if it had no such declared property). If
				the property has length 1, the value is only that byte. If it has length 2, the first two bytes of the
				property are taken as a word value. It is illegal for the opcode to be used if the property has
				length greater than 2, and the result is unspecified. */
			const obj = state.objectTable.getObject(operands[0]);
			const propertyTable = decodePropertyTable(state, obj.properties);
			const property = propertyTable.properties.find(entry => entry.number === operands[1]);
			if (property) {
				performStore(state, instruction.resultVariable, property.length === 1 ?
					property.data.getUint8(0) :
					property.data.getUint16(0, false));
			} else {
				performStore(state, instruction.resultVariable, state.objectTable.getDefault(operands[1]));
			}
		} break;

		case 'get_prop_addr': {
			/* get_prop_addr
				2OP:18 12 get_prop_addr object property -> (result)
				Get the byte address (in dynamic memory) of the property data for the given object's property.
				This must return 0 if the object hasn't got the property. */
			const obj = state.objectTable.getObject(operands[0]);
			const propertyTable = decodePropertyTable(state, obj.properties);
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
			const obj = state.objectTable.getObject(operands[0]);
			performStore(state, instruction.resultVariable, obj.sibling);

			const test = obj.sibling !== 0;
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
			const [objId, destId] = operands;
			const obj = state.objectTable.getObject(objId);
			const dest = state.objectTable.getObject(destId);

			if (obj.parent !== 0) {
				const parent = state.objectTable.getObject(obj.parent);
				if (parent.child === objId) {
					parent.child = 0;
				} else {
					let o = state.objectTable.getObject(parent.child);
					for (;;) {
						if (o.sibling === objId) {
							break;
						}
						o = state.objectTable.getObject(o.sibling);
					}
					o.sibling = obj.sibling;
				}
			}

			obj.parent = destId;
			obj.sibling = dest.child;
			dest.child = objId;
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
			const obj1 = state.objectTable.getObject(operands[0]);
			const test = obj1.parent === operands[1];
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
			const address = operands[0] + 2*operands[1];
			performStore(state, instruction.resultVariable, state.memory[address]);
		} break;

		case 'loadw': {
			/* loadw
				2OP:15 F loadw array word-index -> (result)
				Stores array-->word-index (i.e., the word at address array+2*word-index, which must lie in
				static or dynamic memory). */
			const address = operands[0] + 2*operands[1];
			const view = new DataView(state.buffer, address, 2);
			performStore(state, instruction.resultVariable, view.getUint16(0, false));
		} break;

		case 'new_line': {
			/* new_line
				0OP:187 B new_line
				Print carriage return. */
			process.stdout.write('\n');
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
			const text = instruction.text;
			process.stdout.write(text);
		} break;

		case 'print_char': {
			/* print_char
				VAR:229 5 print_char output-character-code
				Print a ZSCII character. The operand must be a character code defined in ZSCII for output (see S
				3). In particular, it must certainly not be negative or larger than 1023. */
			process.stdout.write(String.fromCharCode(operands[0]));
		} break;

		case 'print_num': {
			/* print_num
				VAR:230 6 print_num value
				Print (signed) number in decimal. */
			const value = new Int16Array([operands[0]])[0];
			process.stdout.write(value.toString(10));
		} break;

		case 'print_obj': {
			/* print_obj
				1OP:138 A print_obj object
				Print short name of object (the Z-encoded string in the object header, not a property). If the object
				number is invalid, the interpreter should halt with a suitable error message. */
			const obj = state.objectTable.getObject(operands[0]);
			const propertyTable = decodePropertyTable(state, obj.properties);
			process.stdout.write(propertyTable.shortName);
		} break;

		case 'pull': {
			/* pull
				VAR:233 9 1 pull (variable)
				6 pull stack -> (result)
				Pulls value off a stack. (If the stack underflows, the interpreter should halt with a suitable error
				message.) In Version 6, the stack in question may be specified as a user one: otherwise it is the
				game stack. */
			const frame = currentStackFrame(state);
			const variable = decodeVariable(operands[0]);
			const value = frame.stack.pop();
			performStore(state, variable, value);
		} break;

		case 'push': {
			/* push
				VAR:232 8 push value
				Pushes value onto the game stack. */
			const frame = currentStackFrame(state);
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
			const obj = state.objectTable.getObject(operands[0]);
			const propertyTable = decodePropertyTable(state, obj.properties);
			const property = propertyTable.properties.find(property => property.number === operands[1]);
			if (!property) {
				throw new Error(`property ${operands[1]} does not exist on object ${operands[0]}`);
			}
			if (property.length === 1) {
				property.data.setUint8(0, operands[2] & 0xFF);
			} else {
				// NOTE: if property length is more than 2, behavior is undefined.
				// Here we just leave the extra data without overwriting it.
				property.data.setUint16(0, operands[2], false);
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
			return {
				yield: true,
				instruction,
				operands
			};
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
			const obj = state.objectTable.getObject(operands[0]);
			obj.setAttribute(operands[1]);
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
			const view = new DataView(state.buffer, address, 2);
			view.setUint16(0, operands[2], false);
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
			const obj = state.objectTable.getObject(operands[0]);
			const test = obj.getAttribute(operands[1]);
			if (test === instruction.branchIf) {
				performBranch(state, instruction.branchOffset);
			}
		} break;

		default: {
			throw new Error(`unimplemented opcode ${instruction.opcode.op}`);
		}
	}

	return false;
}

function performBranch(state, offset) {
	if (offset === 0) {
		performReturn(state, 0);
	} else if (offset === 1) {
		performReturn(state, 1);
	} else {
		state.pc = (state.pc + offset - 2) & 0xFFFF;
	}
}

function performReturn(state, value) {
	const frame = state.stack.pop();
	if (frame.resultVariable) {
		performStore(state, frame.resultVariable, value);
	}
	state.pc = frame.nextAddress;
}

function performDereference(state, operand) {
	if (operand.type === 'largeconstant' || operand.type === 'smallconstant') {
		return operand.value;
	}

	if (operand.type === 'global') {
		const view = new DataView(state.buffer, state.header.globalTableAddress + 2*operand.index, 2);
		return view.getUint16(0, false);
	}

	const frame = currentStackFrame(state);

	if (operand.type === 'local') {
		return frame.localVariables[operand.index];
	}

	if (operand.type === 'stack') {
		if (frame.stack.length < 1) {
			throw new Error('stack underflow');
		}
		return frame.stack.pop();
	}
}

function performStore(state, variable, value) {
	if (variable.type === 'global') {
		const view = new DataView(state.buffer, state.header.globalTableAddress + 2*variable.index, 2);
		view.setUint16(0, value, false);
		return;
	}

	const frame = currentStackFrame(state);

	if (variable.type === 'local') {
		frame.localVariables[variable.index] = value;
		return;
	}

	if (variable.type === 'stack') {
		frame.stack.push(value);
		return;
	}
}

function currentStackFrame(state) {
	return state.stack[state.stack.length - 1];
}

function unpackAddress(state, op, packedAddress) {
	if (state.header.version <= 3) {
		return packedAddress * 2;
	}
	if (state.header.version <= 5) {
		return packedAddress * 4;
	}
	if (state.header.version <= 7) {
		if (op === 'print_paddr') {
			return packedAddress * 4 + state.header.staticStringsOffset;
		} else {
			return packedAddress * 4 + state.header.routinesOffset;
		}
	}
	return packedAddress * 8;
}

function instructionToString(instruction) {
	let result = `0x${instruction.address.toString(16).padStart(4, 0)}  ${instruction.form}  ${instruction.raw}\n        `;
	if (!instruction.opcode) {
		result += 'INVALID';
	} else {
		if (instruction.opcode.store) {
			result += `${operandToString(instruction.resultVariable)} = `;
		}
		result += instruction.opcode.op + ' ';
		result += instruction.operands.map(operandToString).join(' ');
		if (instruction.opcode.text) {
			result += ` "${instruction.text}"`;
		}
		if (instruction.opcode.branch) {
			if (instruction.branchOffset <= 1) {
				result += ` ${instruction.branchIf}=>return ${instruction.branchOffset}`;
			} else {
				result += ` ${instruction.branchIf}=>0x${(instruction.nextAddress + instruction.branchOffset - 2).toString(16).padStart(4, 0)}`;
			}
		}
	}

	return result;
}

function operandToString(operand) {
	if (operand.type === 'largeconstant') {
		return `0x${operand.value.toString(16).padStart(4, 0)}`;
	}
	if (operand.type === 'smallconstant') {
		return `0x${operand.value.toString(16).padStart(2, 0)}`;
	}
	if (operand.type === 'stack') {
		return '(stack)';
	}
	if (operand.type === 'local') {
		return `L${operand.index.toString(16)}`;
	}
	if (operand.type === 'global') {
		return `G${operand.index.toString(16)}`;
	}
}

function defineHeader(buffer) {
	function descriptor1(buffer, offset, bit) {
		const view = new DataView(buffer, offset, 1);
		return {
			enumerable: true,
			get() {
				return !!(view.getUint8(0) & (1 << bit));
			},
			set(value) {
				view.setUint8(0, value ?
					view.getUint8(0) | (1 << bit) :
					view.getUint8(0) & ~(1 << bit)
				);
			}
		}
	}

	function descriptor8(buffer, offset) {
		const view = new DataView(buffer, offset, 1);
		return {
			enumerable: true,
			get() { return view.getUint8(0); },
			set(value) { view.setUint8(0, value); }
		}
	}

	function descriptor16(buffer, offset) {
		const view = new DataView(buffer, offset, 2);
		return {
			enumerable: true,
			get() { return view.getUint16(0, false); },
			set(value) { view.setUint16(0, value, false); }
		}
	}

	const header = { flags: {} };
	Object.defineProperties(header, {
		version:                           descriptor8 (buffer, 0x00),
		flags1:                            descriptor8 (buffer, 0x01),
		highMemoryBase:                    descriptor16(buffer, 0x04),
		initialProgramCounter:             descriptor16(buffer, 0x06),
		dictionaryAddress:                 descriptor16(buffer, 0x08),
		objectTableAddress:                descriptor16(buffer, 0x0A),
		globalTableAddress:                descriptor16(buffer, 0x0C),
		staticMemoryBase:                  descriptor16(buffer, 0x0E),
		flags2:                            descriptor8 (buffer, 0x10),
		abbreviationsTableAddress:         descriptor16(buffer, 0x18),
		fileLength: ((buffer, offset) => {
			const view = new DataView(buffer, offset, 2);
			return {
				enumerable: true,
				get() {
					const divisor =
						header.version <= 3 ? 2 :
						header.version <= 5 ? 4 :
						8;
					return view.getUint16(0, false) * divisor;
				},
				set(value) {
					const divisor =
						header.version <= 3 ? 2 :
						header.version <= 5 ? 4 :
						8;
					view.setUint16(0, (value / divisor) | 0, false);
				}
			}
		})(buffer, 0x1A),
		fileChecksum:                      descriptor16(buffer, 0x1C),
		interpreterNumber:                 descriptor8 (buffer, 0x1E),
		interpreterVersion:                descriptor8 (buffer, 0x1F),
		screenHeightLines:                 descriptor8 (buffer, 0x20),
		screenWidthCharacters:             descriptor8 (buffer, 0x21),
		screenWidthUnits:                  descriptor16(buffer, 0x22),
		screenHeightUnits:                 descriptor16(buffer, 0x24),
		fontWidthUnits:                    descriptor8 (buffer, 0x26),
		fontHeightUnits:                   descriptor8 (buffer, 0x27),
		routinesOffset:                    descriptor16(buffer, 0x28),
		staticStringsOffset:               descriptor16(buffer, 0x2A),
		defaultBackgroundColor:            descriptor8 (buffer, 0x2C),
		defaultForegroundColor:            descriptor8 (buffer, 0x2D),
		terminatingCharactersTableAddress: descriptor16(buffer, 0x2E),
		standardRevisionNumber:            descriptor16(buffer, 0x32),
		alphabetTableAddress:              descriptor16(buffer, 0x34),
		headerExtensionTableAddress:       descriptor16(buffer, 0x36)
	});

	Object.defineProperties(header.flags, {
		// versions 1-3
		statusLineType: descriptor1(buffer, 0x01, 1),
		storyFileSplit: descriptor1(buffer, 0x01, 2),
		statusLineNotAvailable: descriptor1(buffer, 0x01, 4),
		screenSplittingAvailable: descriptor1(buffer, 0x01, 5),
		variablePitchFontDefault: descriptor1(buffer, 0x01, 6),

		// versions 4+
		colorsAvailable: descriptor1(buffer, 0x01, 0),
		pictureDisplayingAvailable: descriptor1(buffer, 0x01, 1),
		boldAvailable: descriptor1(buffer, 0x01, 2),
		italicsAvailable: descriptor1(buffer, 0x01, 3),
		fixedSpaceFontAvailable: descriptor1(buffer, 0x01, 4),
		soundEffectsAvailable: descriptor1(buffer, 0x01, 5),
		timedKeyboardInputAvailable: descriptor1(buffer, 0x01, 7),

		transcriptingOn: descriptor1(buffer, 0x10, 0),
		forceFixedPitch: descriptor1(buffer, 0x10, 1),
		statusLineRedrawRequested: descriptor1(buffer, 0x10, 2),
		picturesRequested: descriptor1(buffer, 0x10, 3),
		undoRequested: descriptor1(buffer, 0x10, 4),
		mouseRequested: descriptor1(buffer, 0x10, 5),
		colorsRequested: descriptor1(buffer, 0x10, 6),
		soundEffectsRequested: descriptor1(buffer, 0x10, 7),
		menusRequested: descriptor1(buffer, 0x11, 0)
	});

	return header;
}

function defineObjectTable(buffer, header) {
	const maxPropertyIndex = header.version <= 3 ? 32 : 64;
	const maxObjectIndex = header.version <= 3 ? 255 : 65535;
	const maxAttributeIndex = header.version <= 3 ? 32 : 48;
	const objectSize = header.version <= 3 ? 9 : 14;
	const attributesSize = header.version <= 3 ? 4 : 6;
	const relationsSize = header.version <= 3 ? 3 : 6;

	const defaultsBase = header.objectTableAddress;
	const objectsBase = defaultsBase + ((maxPropertyIndex - 1) * 2);

	const objectTable = {
		getDefault(propertyIndex) {
			if (propertyIndex > maxPropertyIndex) {
				throw new Error(`tried to read default for invalid property index ${propertyIndex}`);
			}
			const view = new DataView(buffer, defaultsBase + 2 * (propertyIndex - 1));
			return view.getUint16(0, false);
		},

		getObject(objectIndex) {
			if (objectIndex > maxObjectIndex) {
				throw new Error(`tried to read invalid object index ${objectIndex}`);
			}

			const objectBase = objectsBase + objectSize * (objectIndex - 1);

			function relationDescriptor(n) {
				return {
					enumerable: true,
					get() {
						const view = new DataView(buffer, objectBase + attributesSize, relationsSize);
						if (header.version <= 3) {
							return view.getUint8(n);
						} else {
							return view.getUint16(n, false);
						}
					},
					set(value) {
						const view = new DataView(buffer, objectBase + attributesSize, relationsSize);
						if (header.version <= 3) {
							view.setUint8(n, value);
						} else {
							view.setUint16(n, value, false);
						}
					}
				};
			}

			const obj = {
				getAttribute(attributeIndex) {
					const view = new DataView(buffer, objectBase, attributesSize);
					const byte = view.getUint8(attributeIndex / 8 | 0);
					const bit = (1 << (7 - (attributeIndex % 8)));
					return !!(byte & bit);
				},

				setAttribute(attributeIndex, value) {
					const view = new DataView(buffer, objectBase, attributesSize);
					let byte = view.getUint8(attributeIndex / 8 | 0);
					const bit = (1 << (7 - (attributeIndex % 8)));
					if (value) {
						byte |= bit;
					} else {
						byte &= ~bit;
					}
					view.setUint8(attributeIndex / 8 | 0, byte);
				}
			}

			Object.defineProperties(obj, {
				parent: relationDescriptor(0),
				sibling: relationDescriptor(1),
				child: relationDescriptor(2),
				properties: {
					enumerable: true,
					get() {
						const view = new DataView(buffer, objectBase + attributesSize + relationsSize, 2);
						return view.getUint16(0, false);
					},
					set(value) {
						const view = new DataView(buffer, objectBase + attributesSize + relationsSize, 2);
						view.setUint16(0, value, false);
					}
				}
			});

			return obj;
		}
	};

	return objectTable;
}

function decodeRoutine(state, address) {
	const localVariableCount = state.memory[address];
	const localVariables = [];

	address += 1;

	if (state.header.version <= 4) {
		for (let i = 0; i < localVariableCount; ++i) {
			const view = new DataView(state.buffer, address);
			localVariables.push(view.getUint16(0, false));
			address += 2;
		}
	} else {
		for (let i = 0; i < localVariableCount; ++i) {
			localVariables.push(0);
		}
	}
	return {
		localVariables,
		firstInstructionAddress: address
	};
}

function decodeText(state, address, isAbbreviation = false) {
	const version = state.header.version;

	let text = '';
	let alphabet = 0;
	let shift = null;
	let abbr = null;
	let tenbit = null;

	for (;;) {
		const view = new DataView(state.buffer, address, 2);
		address += 2;

		const encoded = view.getUint16(0, false);
		debuglog(`0x${encoded.toString(16).padStart(4, 0)}  0b${encoded.toString(2).padStart(16, 0)}`)
		const zchars = [
			(encoded >> 10) & 0x1F,
			(encoded >> 5) & 0x1F,
			(encoded >> 0) & 0x1F
		];
		zchars.forEach(c => {
			if (abbr != null) {
				// debuglog(`ABBR ${abbr}/${c}`);
				const view = new DataView(state.buffer, state.header.abbreviationsTableAddress + 2 * (abbr + c), 2);
				const abbreviationAddress = 2 * view.getUint16(0, false);
				text += decodeText(state, abbreviationAddress, true).text;
				abbr = null;
			} else if (tenbit != null) {
				if (tenbit === -1) {
					tenbit = c;
				} else {
					text += String.fromCharCode(tenbit << 5 | c);
					tenbit = null;
				}
			} else if (c === 0) {
				text += ' ';
			} else if (c === 1 && state.header.version === 1) {
				text += '\n';
			} else if (
				(c === 1 && state.header.version === 2) ||
				(c >= 1 && c <= 3 && state.header.version >= 3)
			) {
				if (isAbbreviation) {
					throw new Error('abbreviation used from inside abbreviation');
				}
				abbr = 32*(c-1);
			} else if (c === 2 && state.header.version <= 2) {
				shift = (alphabet + 1) % 3;
			} else if (c === 3 && state.header.version <= 2) {
				shift = (alphabet + 2) % 3;
			} else if (c === 4 && state.header.version <= 2) {
				alphabet = (alphabet + 1) % 3;
			} else if (c === 5 && state.header.version <= 2) {
				alphabet = (alphabet + 2) % 3;
			} else if (c === 4 && state.header.version >= 3) {
				// debuglog('SHIFT 1');
				shift = 1;
			} else if (c === 5 && state.header.version >= 3) {
				// debuglog('SHIFT 2');
				shift = 2;
			} else if (c >= 6) {
				const a = shift != null ? shift : alphabet;
				shift = null;

				if (a === 2 && c === 6) {
					// debuglog('TEN');
					tenbit = -1;
				} else if (version <= 4 || state.header.alphabetTableAddress === 0) {
					const char = [
						'abcdefghijklmnopqrstuvwxyz',
						'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
						version === 1 ?
							' 0123456789.,!?_#\'"/\\<-:()' :
							' \n0123456789.,!?_#\'"/\\-:()'
					][a][c-6];
					// debuglog(`CHAR ${a}/${c-6+1} ${char}`);
					text += char;
				} else {
					const index = 26 * a + (c - 6);
					text += String.fromCharCode(state.memory[state.header.alphabetTableAddress + index]);
				}
			}
		});

		if (encoded & 0x8000) {
			break;
		}
	}

	return { text, nextAddress: address };
}

function decodeVariable(variable) {
	if (variable === 0) {
		return { type: 'stack' };
	} else if (variable <= 0x0F) {
		return { type: 'local', index: variable - 0x01 };
	} else {
		return { type: 'global', index: variable - 0x10 };
	}
}

function decodeInstruction(state, address) {
	const result = {
		address,
		operandTypes: [],
		operands: [],
		raw: ''
	};
	result.form =
		(state.memory[address] & 0xC0) === 0xC0 ? 'variable' :
		(state.memory[address] & 0xC0) === 0x80 ? 'short' :
		(state.header.version >= 5 && state.memory[address] === 0xBE) ? 'extended' :
		'long';

	let operandCount, opcode;
	if (result.form === 'short') {
		operandCount = ((state.memory[address] & 0x30) === 0x30) ? 0 : 1;
		opcode = state.memory[address] & 0x0F;
		result.operandTypes.push((state.memory[address] >> 4) & 0x03);
	} else if (result.form === 'long') {
		operandCount = 2;
		opcode = state.memory[address] & 0x1F;
		result.operandTypes.push((state.memory[address] & 0x40) ? TYPE_VARIABLE : TYPE_SMALL_CONSTANT);
		result.operandTypes.push((state.memory[address] & 0x20) ? TYPE_VARIABLE : TYPE_SMALL_CONSTANT);
	} else if (result.form === 'variable') {
		operandCount = (state.memory[address] & 0x20) ? 'VAR' : 2;
		opcode = state.memory[address] & 0x1F;
	} else {
		operandCount = 'VAR';

		result.raw += state.memory[address].toString(16).padStart(2, 0);
		++address;

		opcode = state.memory[address];
	}
	result.opcode = lookupOpcode(state.header.version, operandCount, opcode);

	result.raw += state.memory[address].toString(16).padStart(2, 0);
	++address;

	if (result.form === 'variable' || result.form === 'extended') {
		for (let shift = 6; shift >= 0; shift -= 2) {
			const type = (state.memory[address] >> shift) & 0x3;
			if (type == TYPE_OMITTED) {
				break;
			}
			result.operandTypes.push(type);
		}

		result.raw += state.memory[address].toString(16).padStart(2, 0);
		++address;

		if (result.operandTypes.length === 4 && result.opcode && (result.opcode.op === 'call_vs2' || result.opcode.op === 'call_vn2')) {
			for (let shift = 6; shift >= 0; shift -= 2) {
				const type = (state.memory[address] >> shift) & 0x3;
				if (type == TYPE_OMITTED) {
					break;
				}
				result.operandTypes.push(type);
			}

			result.raw += state.memory[address].toString(16).padStart(2, 0);
			++address;
		}
	}

	// TODO: Why doesn't this work? Decodes zork1.z3 @ 0x8EDC incorrectly
	// if (operandCount === 'VAR') {
	if (result.form === 'variable' || result.form === 'extended') {
		result.operandCount = result.operandTypes.length;
	} else {
		result.operandCount = operandCount;
	}

	for (let i = 0; i < result.operandCount; ++i) {
		const type = result.operandTypes[i];
		if (type === TYPE_LARGE_CONSTANT) {
			const view = new DataView(state.buffer, address, 2);
			result.operands.push({ type: 'largeconstant', value: view.getUint16(0, false) });

			result.raw += state.memory[address].toString(16).padStart(2, 0);
			++address;
			result.raw += state.memory[address].toString(16).padStart(2, 0);
			++address;
		} else if (type === TYPE_SMALL_CONSTANT) {
			result.operands.push({ type: 'smallconstant', value: state.memory[address] });

			result.raw += state.memory[address].toString(16).padStart(2, 0);
			++address;
		} else {
			result.operands.push(decodeVariable(state.memory[address]));

			result.raw += state.memory[address].toString(16).padStart(2, 0);
			++address;
		}
	}

	if (result.opcode && result.opcode.store) {
		result.resultVariable = decodeVariable(state.memory[address]);

		result.raw += state.memory[address].toString(16).padStart(2, 0);
		++address;
	}

	if (result.opcode && result.opcode.branch) {
		result.branchIf = !!(state.memory[address] & 0x80);
		let branchOffset;
		if (state.memory[address] & 0x40) {
			result.branchOffset = state.memory[address] & 0x3F;
		} else {
			result.branchOffset = state.memory[address] & 0x3F << 8;

			result.raw += state.memory[address].toString(16).padStart(2, 0);
			++address;

			result.branchOffset += state.memory[address];
		}

		result.raw += state.memory[address].toString(16).padStart(2, 0);
		++address;
	}

	if (result.opcode && result.opcode.text) {
		const text = decodeText(state, address);
		result.text = text.text;

		while (address < text.nextAddress) {
			result.raw += state.memory[address].toString(16).padStart(2, 0);
			++address;
		}
	}

	result.nextAddress = address;
	return result;
}

function decodePropertyTable(state, address) {
	const shortNameLength = state.memory[address];
	const shortName = decodeText(state, address + 1).text;

	const properties = [];

	address = address + 1 + (shortNameLength * 2);

	for (;;) {
		let length, number;

		const sizeByte = state.memory[address];
		if (sizeByte === 0) {
			break;
		}

		if (state.header.version <= 3) {
			number = sizeByte & 0x1F;
			length = (sizeByte >> 5) + 1;
		} else {
			number = sizeByte & 0x3F;
			if (sizeByte & 0x80) {
				++address;
				length = (state.memory[address] & 0x3F) || 64;
			} else if (sizeByte & 0x40) {
				length = 2;
			} else {
				length = 1;
			}
		}

		++address;
		properties.push({ number, address, length, data: new DataView(state.buffer, address, length) });
		address += length;
	}

	return {
		shortName,
		properties
	};
}

function decodeDictionaryTable(state) {
	let address = header.dictionaryAddress;

	const dictionary = {};

	const wordSeparatorCount = state.memory[address++];
	const wordSeparators = [];
	for (let i = 0; i < wordSeparatorCount; ++i) {
		wordSeparators.push(state.memory[address++]);
	}

	const entryLength = state.memory[address++];
	const entryCount = new DataView(buffer, address, 2).getUint16(0, false);
	address += 2;

	const entries = [];
	const encodedTextLength = state.header.version <= 3 ? 4 : 6;
	const dataLength = entryLength - encodedTextLength;
	for (let i = 0; i < entryCount; ++i) {
		const encodedText = new DataView(buffer, address, encodedTextLength);
		address += encodedTextLength;
		const data = new DataView(buffer, address, dataLength);
		address += dataLength;

		entries.push({ encodedText, data });
	}

	return {
		wordSeparators,
		entries,
		encodedTextLength,
		dataLength
	};
}
//
// function parseText(text) {
// 	const tokens = text.split(/\b/).filter(x => !/^\s*$/.test(x));
// }
//
// function encodeText(text) {
// 	const char = [
// 		'abcdefghijklmnopqrstuvwxyz',
// 		'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
// 		version === 1 ?
// 			' 0123456789.,!?_#\'"/\\<-:()' :
// 			' \n0123456789.,!?_#\'"/\\-:()'
// 	][a][c-6];
//
// 	for (let i = 0; i < text.length; i += 3) {
//
// 	}
// }
