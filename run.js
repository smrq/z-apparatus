const TYPE_LARGE_CONSTANT = 0x0;
const TYPE_SMALL_CONSTANT = 0x1;
const TYPE_VARIABLE = 0x2;
const TYPE_OMITTED = 0x3;

const RELATION_PARENT = 0;
const RELATION_SIBLING = 1;
const RELATION_CHILD = 2;

function run(state, output, input, random) {
	const instruction = decodeInstruction(state, state.pc);
	if (!instruction.opcode) {
		throw new Error(`invalid instruction at 0x${state.pc.toString(16)}`);
	}
	if (instruction.opcode.input && input == null) {
		return 'yield';
	}
	if (instruction.opcode.op === 'quit') {
		return 'quit';
	}
	const operands = instruction.operands.map(operand => operand.type === 'constant' ?
			operand.value :
			variableLoad(state, operand.value));
	// debugInstruction(instruction, operands);
	// debugZorkmid(state, instruction, operands);
	state.pc = instruction.nextAddress;
	return executeInstruction(state, instruction, operands, output, input, random);
}

function debugInstruction(instruction, operands) {
	function opStr(operand, i) {
		if (operand.type === 'constant') {
			return `0x${operand.value.toString(16).padStart(4, 0)}`;
		} else if (operand.value === 0) {
			return 'ST' + (i != null ? `(0x${operands[i].toString(16)})` : '');
		} else if (operand.value <= 0x0F) {
			return `L${(operand.value - 1).toString(16)}` + (i != null ? `(0x${operands[i].toString(16)})` : '');
		} else {
			return `G${(operand.value - 0x0F).toString(16)}` + (i != null ? `(0x${operands[i].toString(16)})` : '');
		}
	}

	let result = `0x${instruction.address.toString(16).padStart(4, '0')}: <`;
	result += instruction.raw.map(byte => byte.toString(16).padStart(2, '0')).join(' ') + '>  ';
	if (!instruction.opcode) {
		result += '[invalid opcode]';
	} else {
		if (instruction.opcode.store) {
			result += `${opStr({ type: 'variable', value: instruction.resultVariable })} = `;
		}
		result += instruction.opcode.op + ' ';
		result += instruction.operands.map(opStr).join(' ');
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

	console.error(result);
}

function debugOperands(operands) {
	console.error('  (' + operands.map(op => op && op.toString(16).padStart(4, 0)).join(' ') + ')');
}

function debugZorkmid(state, instruction, operands) {
	function opStr(operand) {
		if (typeof operand === 'number') {
			return operand.toString(16).padStart(4, '0');
		} else {
			return operand;
		}
	}

	console.error('<' +
		instruction.address.toString(16).padStart(6, '0') + ' ' +
		instruction.raw[0].toString(16).padStart(2, '0') + ' ' +
		operands.length + ' ' +
		opStr(operands.length > 0 ? operands[0] : 0) + ' ' +
		opStr(operands.length > 1 ? operands[1] : 0) + ' ' +
		opStr(operands.length > 2 ? operands[2] : 0) + ' ' +
		opStr(operands.length > 3 ? operands[3] : 0) + '> | ' +
		(state.stack[state.stack.length-1].stack.slice(-1)[0] || 0).toString(16).padStart(4, '0') + ' | ' +
		(state.stack[state.stack.length-1].localVariables ? state.stack[state.stack.length-1].localVariables.map(l => l.toString(16).padStart(4, '0') + ' ').join('') : '')
	);
}

function read16(buffer, address) {
	return buffer[address] << 8 | buffer[address + 1];
}

function write16(buffer, address, value) {
	buffer[address + 0] = (value >> 8) & 0xFF;
	buffer[address + 1] = (value >> 0) & 0xFF;
}

function decodeDictionaryTable(state) {
	let address = getDictionaryAddress(state);

	const dictionary = {};

	const wordSeparatorCount = state.memory[address++];
	let wordSeparators = '';
	for (let i = 0; i < wordSeparatorCount; ++i) {
		wordSeparators += String.fromCharCode(state.memory[address++]);
	}

	const entryLength = state.memory[address++];
	const entryCount = read16(state.memory, address);
	address += 2;

	const entries = [];
	const textLength = getVersion(state) <= 3 ? 6 : 9;
	const encodedTextLength = getVersion(state) <= 3 ? 4 : 6;
	const dataLength = entryLength - encodedTextLength;
	for (let i = 0; i < entryCount; ++i) {
		const encodedText = state.memory.slice(address, address + encodedTextLength);
		const data = state.memory.slice(address + encodedTextLength, address + encodedTextLength + dataLength);
		entries.push({ number: i, encodedText, data, address });
		address += encodedTextLength + dataLength;
	}

	return {
		wordSeparators,
		entries,
		textLength,
		encodedTextLength,
		dataLength
	};
}

function decodeText(state, address, isAbbreviation = false) {
	const version = getVersion(state);
	const alphabets = getAlphabets(state);

	let text = '';
	let alphabet = 0;
	let shift = null;
	let abbr = null;
	let tenbit = null;

	for (;;) {
		const encoded = read16(state.memory, address);
		address += 2;

		// console.log('0x' + encoded.toString(16).padStart(4, '0') + '  0b' + encoded.toString(2).padStart(16, '0'));

		const zchars = [
			(encoded >> 10) & 0x1F,
			(encoded >> 5) & 0x1F,
			(encoded >> 0) & 0x1F
		];

		zchars.forEach(c => {
			if (abbr != null) {
				const abbreviationAddress = 2 * read16(state.memory, getAbbreviationsTableAddress(state) + 2 * (abbr + c));
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
			} else if (c === 1 && version === 1) {
				text += '\n';
			} else if (
				(c === 1 && version === 2) ||
				(c >= 1 && c <= 3 && version >= 3)
			) {
				if (isAbbreviation) {
					throw new Error('abbreviation used from inside abbreviation');
				}
				abbr = 32*(c-1);
			} else if (c === 2 && version <= 2) {
				shift = (alphabet + 1) % 3;
			} else if (c === 3 && version <= 2) {
				shift = (alphabet + 2) % 3;
			} else if (c === 4 && version <= 2) {
				alphabet = (alphabet + 1) % 3;
			} else if (c === 5 && version <= 2) {
				alphabet = (alphabet + 2) % 3;
			} else if (c === 4 && version >= 3) {
				shift = 1;
			} else if (c === 5 && version >= 3) {
				shift = 2;
			} else if (c >= 6) {
				const a = shift != null ? shift : alphabet;
				shift = null;

				if (a === 2 && c === 6) {
					tenbit = -1;
				} else if (version <= 4 || getAlphabetTableAddress(state) === 0) {
					const char = alphabets[a][c-6];
					text += char;
				} else {
					const index = 26 * a + (c - 6);
					text += String.fromCharCode(state.memory[getAlphabetTableAddress(state) + index]);
				}
			}
		});

		if (encoded & 0x8000) {
			break;
		}
	}

	return { text, nextAddress: address };
}

function encodeText(state, text) {
	const alphabets = getAlphabets(state);
	const version = getVersion(state);

	const zchars = [];
	const result = [];

	text.split('').forEach(char => {
		let index;
		if (char === ' ') {
			zchars.push(0);
		} else if (char === '\0') {
			zchars.push(5);
		} else if ((index = alphabets[0].indexOf(char)) > -1) {
			zchars.push(6 + index);
		} else if ((index = alphabets[1].indexOf(char)) > -1) {
			zchars.push(version <= 2 ? 2 : 4);
			zchars.push(6 + index);
		} else if ((index = alphabets[2].indexOf(char)) > -1) {
			zchars.push(version <= 2 ? 3 : 5);
			zchars.push(6 + index);
		} else {
			// could not encode character
			return null;
		}
	});

	for (let i = 0; i < zchars.length; i += 3) {
		let value = (zchars[i] << 10) |
			((i + 1 < zchars.length ? zchars[i + 1] : 5) << 5) |
			((i + 2 < zchars.length ? zchars[i + 2] : 5) << 0) |
			((i + 3 < zchars.length ? 0 : (1 << 15)));
		result.push((value >> 8) & 0xFF);
		result.push((value >> 0) & 0xFF);
	}

	return result;
}

function getVersion(state) {
	return state.memory[0];
}

function getDictionaryAddress(state) {
	return read16(state.memory, 0x08);
}

function getObjectTableAddress(state) {
	return read16(state.memory, 0x0A);
}

function getGlobalTableAddress(state) {
	return read16(state.memory, 0x0C);
}

function getAbbreviationsTableAddress(state) {
	return read16(state.memory, 0x18);
}

function getRoutinesOffset(state) {
	return read16(state.memory, 0x28);
}

function getStaticStringsOffset(state) {
	return read16(state.memory, 0x2A);
}

function getAlphabetTableAddress(state) {
	return read16(state.memory, 0x34);
}

function getAlphabets(state) {
	return [
		'abcdefghijklmnopqrstuvwxyz',
		'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
		getVersion(state) === 1 ?
			' 0123456789.,!?_#\'"/\\<-:()' :
			' \n0123456789.,!?_#\'"/\\-:()'
	];
}

function lookupOpcode(state, code, operandCount) {
	return state.opcodeTable.find(entry =>
		entry.code === code &&
		entry.operandCount === operandCount);
}

function getDefaultPropertyData(state, propertyId) {
	const version = getVersion(state);
	const maxPropertyId = version <= 3 ? 32 : 64;

	if (propertyId > maxPropertyId || propertyId < 1) {
		throw new Error(`tried to read invalid default property id ${propertyId}`);
	}

	const base = getObjectTableAddress(state);
	const address = base + 2 * (propertyId - 1);
	return read16(state.memory, address);
}

function getObjectBase(state, objectId) {
	const version = getVersion(state);
	const maxObjectId = version <= 3 ? 255 : 65535;

	if (objectId > maxObjectId || objectId < 1) {
		throw new Error(`tried to find invalid object id ${objectId}`);
	}

	const maxPropertyId = version <= 3 ? 32 : 64;
	const objectSize = version <= 3 ? 9 : 14;

	return getObjectTableAddress(state) + 2 * (maxPropertyId - 1) + objectSize * (objectId - 1);
}

function getAttributeBase(state, objectId, attributeId) {
	const version = getVersion(state);
	const base = getObjectBase(state, objectId);

	const maxAttributeId = version <= 3 ? 32 : 48;
	if (attributeId >= maxAttributeId || attributeId < 0) {
		throw new Error(`tried to find invalid attribute id ${attributeId}`);
	}

	const address = base + (attributeId >> 3);
	const bit = 7 - (attributeId & 0x7);
	return [address, bit];
}

function getObjectAttribute(state, objectId, attributeId) {
	const [address, bit] = getAttributeBase(state, objectId, attributeId);
	return !!(state.memory[address] & (1 << bit));
}

function setObjectAttribute(state, objectId, attributeId, value) {
	const [address, bit] = getAttributeBase(state, objectId, attributeId);
	if (value) {
		state.memory[address] |= (1 << bit);
	} else {
		state.memory[address] &= ~(1 << bit);
	}
}

function getObjectRelation(state, objectId, relationNumber) {
	const version = getVersion(state);
	const base = getObjectBase(state, objectId);
	return version <= 3 ?
		state.memory[base + 4 + relationNumber] :
		read16(state.memory, base + 6 + 2 * relationNumber);
}

function setObjectRelation(state, objectId, relationNumber, relation) {
	const version = getVersion(state);
	const base = getObjectBase(state, objectId);
	if (version <= 3) {
		state.memory[base + 4 + relationNumber] = relation;
	} else {
		write16(state.memory, base + 6 + 2 * relationNumber, relation);
	}
}

function moveObject(state, obj, dest) {
	const parent = getObjectRelation(state, obj, RELATION_PARENT);
	if (parent !== 0) {
		const sibling = getObjectRelation(state, obj, RELATION_SIBLING);
		let node = getObjectRelation(state, parent, RELATION_CHILD);
		if (node === obj) {
			setObjectRelation(state, parent, RELATION_CHILD, sibling);
		} else {
			let nodeSibling = getObjectRelation(state, node, RELATION_SIBLING);
			while (nodeSibling !== obj) {
				node = nodeSibling;
				nodeSibling = getObjectRelation(state, node, RELATION_SIBLING);
			}
			setObjectRelation(state, node, RELATION_SIBLING, sibling);
		}
	}

	if (dest !== 0) {
		const destChild = getObjectRelation(state, dest, RELATION_CHILD);
		setObjectRelation(state, obj, RELATION_SIBLING, destChild);
		setObjectRelation(state, dest, RELATION_CHILD, obj);
	} else {
		setObjectRelation(state, obj, RELATION_SIBLING, 0);
	}

	setObjectRelation(state, obj, RELATION_PARENT, dest);
}

function getObjectPropertiesAddress(state, objectId) {
	const version = getVersion(state);
	const base = getObjectBase(state, objectId);
	return read16(state.memory, base + (version <= 3 ? 7 : 12));
}

function setObjectPropertiesAddress(state, objectId, address) {
	const version = getVersion(state);
	const base = getObjectBase(state, objectId);
	write16(state.memory, base + (version <= 3 ? 7 : 12), address);
}

function getObjectName(state, objectId) {
	let address = getObjectPropertiesAddress(state, objectId);
	return decodeText(state, address + 1).text;
}

function getObjectFirstPropertyAddress(state, objectId) {
	let address = getObjectPropertiesAddress(state, objectId);
	return address + 1 + 2 * (state.memory[address]);
}

function getPropertyNumber(state, address) {
	if (state.memory[address] === 0) {
		return 0;
	} else if (getVersion(state) <= 3) {
		return state.memory[address] & 0x1F;
	} else {
		return state.memory[address] & 0x3F;
	}
}

function getPropertyDataAddress(state, address) {
	if ((getVersion(state) <= 3) || !(state.memory[address] & 0x80)) {
		return address + 1;
	} else {
		return address + 2;
	}
}

function getPropertyDataLength(state, address) {
	if (getVersion(state) <= 3) {
		return 1 + (state.memory[address] >> 5);
	} else if (state.memory[address] & 0x80) {
		return (state.memory[address + 1] & 0x3F) || 64;
	} else if (state.memory[address] & 0x40) {
		return 2;
	} else {
		return 1;
	}
}

function getObjectPropertyDataLengthFromDataAddress(state, address) {
	address -= 1;
	if (getVersion(state) <= 3) {
		return 1 + (state.memory[address] >> 5);
	} else if (state.memory[address] & 0x80) {
		return (state.memory[address] & 0x3F) || 64;
	} else if (state.memory[address] & 0x40) {
		return 2;
	} else {
		return 1;
	}
}

function getNextPropertyAddress(state, address) {
	return getPropertyDataAddress(state, address) + getPropertyDataLength(state, address);
}

function getObjectPropertyAddress(state, objectId, propertyId) {
	let address = getObjectFirstPropertyAddress(state, objectId);
	let id = getPropertyNumber(state, address);
	while (id > propertyId) {
		address = getNextPropertyAddress(state, address);
		id = getPropertyNumber(state, address);
	}
	if (id === propertyId) {
		return address;
	} else {
		return 0;
	}
}

function getObjectPropertyDataAddress(state, objectId, propertyId) {
	const address = getObjectPropertyAddress(state, objectId, propertyId);
	return address ? getPropertyDataAddress(state, address) : 0;
}

function getObjectPropertyData(state, objectId, propertyId) {
	const address = getObjectPropertyAddress(state, objectId, propertyId);
	if (!address) {
		return null;
	}
	const dataAddress = getPropertyDataAddress(state, address);
	const length = getPropertyDataLength(state, address);
	return state.memory.slice(dataAddress, dataAddress + length);
}

function getObjectFirstPropertyNumber(state, objectId) {
	const address = getObjectFirstPropertyAddress(state, objectId);
	return getPropertyNumber(state, address);
}

function getObjectNextPropertyNumber(state, objectId, propertyId) {
	const address = getObjectPropertyAddress(state, objectId, propertyId);
	if (address === 0) {
		throw new Error(`tried to get next prop for nonexistent prop ${propertyId} on object ${objectId}`);
	}
	const nextAddress = getNextPropertyAddress(state, address);
	return getPropertyNumber(state, nextAddress);
}

function setObjectPropertyData(state, objectId, propertyId, value) {
	const address = getObjectPropertyAddress(state, objectId, propertyId);
	if (address === 0) {
		throw new Error(`tried to set property data for nonexistent prop ${propertyId} on object ${objectId}`);
	}
	const dataAddress = getPropertyDataAddress(state, address);
	const dataLength = getPropertyDataLength(state, address);

	if (dataLength === 1) {
		state.memory[dataAddress] = value & 0xFF;
	} else {
		write16(state.memory, dataAddress, value);
	}
}

function parseText(state, text, textBufferAddress, parseTableAddress) {
	let address = textBufferAddress;
	const maxInputLength = state.memory[address++] - (getVersion(state) <= 4 ? 1 : 0);
	text = text.slice(0, maxInputLength);

	if (getVersion(state) >= 5) {
		state.memory[address++] = text.length;
	}
	for (let i = 0; i < text.length; ++i) {
		state.memory[address++] = text.charCodeAt(i);
	}
	if (getVersion(state) <= 4) {
		state.memory[address++] = 0;
	}

	if (getVersion(state) <= 4 || parseTableAddress !== 0) {
		const dictionary = decodeDictionaryTable(state);
		const separatorRegex = new RegExp('([ ' + dictionary.wordSeparators.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '])');

		let position = getVersion(state) <= 4 ? 1 : 2;
		let words = text.split(separatorRegex);
		words = words.map(text => {
			const result = {
				text: text.slice(0, dictionary.textLength).padEnd(dictionary.textLength, '\0'),
				length: text.length,
				position
			};
			position += text.length;
			return result;
		});
		words = words.filter(word => /[^\0 ]/.test(word.text));
		words.forEach(word => {
			const encodedText = encodeText(state, word.text);
			if (encodedText) {
				word.entry = dictionary.entries.find(entry =>
					entry.encodedText.every((c, i) => c === encodedText[i]));
			}
		});

		address = parseTableAddress;
		const maxParsedWords = state.memory[address++];
		words = words.slice(0, maxParsedWords);

		state.memory[address++] = words.length;
		words.forEach(word => {
			if (word.entry) {
				write16(state.memory, address, word.entry.address);
				address += 2;
			} else {
				state.memory[address++] = 0;
				state.memory[address++] = 0;
			}

			state.memory[address++] = word.length;
			state.memory[address++] = word.position;
		});
	}
}

function unpackAddress(state, op, packedAddress) {
	if (getVersion(state) <= 3) {
		return packedAddress * 2;
	}
	if (getVersion(state) <= 5) {
		return packedAddress * 4;
	}
	if (getVersion(state) <= 7) {
		if (op === 'print_paddr') {
			return packedAddress * 4 + getStaticStringsOffset(state);
		} else {
			return packedAddress * 4 + getRoutinesOffset(state);
		}
	}
	return packedAddress * 8;
}

function performBranch(state, offset) {
	if (offset === 0) {
		performReturn(state, 0);
	} else if (offset === 1) {
		performReturn(state, 1);
	} else {
		offset = new Int16Array([offset])[0];
		state.pc = state.pc + offset - 2;
	}
}

function performCall(state, op, packedAddress, args, resultVariable = null) {
	let address = unpackAddress(state, op, packedAddress);
	const localVariableCount = state.memory[address++];
	const localVariables = [];

	for (let i = 0; i < localVariableCount; ++i) {
		let value;
		if (getVersion(state) <= 4) {
			value = read16(state.memory, address);
			address += 2;
		} else {
			value = 0;
		}

		if (i < args.length) {
			value = args[i];
		}

		localVariables.push(value);
	}

	const stackFrame = {
		stack: [],
		argumentCount: args.length,
		localVariables,
		resultVariable,
		nextAddress: state.pc
	};
	state.stack.push(stackFrame);
	state.pc = address;
}

function performReturn(state, value) {
	const frame = state.stack.pop();
	if (frame.resultVariable != null) {
		variableStore(state, frame.resultVariable, value);
	}
	state.pc = frame.nextAddress;
}

function variableLoad(state, variable) {
	if (variable === 0) {
		const frame = state.stack[state.stack.length - 1];
		if (frame.stack.length < 1) {
			throw new Error('stack underflow');
		}
		return frame.stack.pop();
	} else if (variable <= 0x0F) {
		const frame = state.stack[state.stack.length - 1];
		return frame.localVariables[variable - 1];
	} else {
		return read16(state.memory, getGlobalTableAddress(state) + 2 * (variable - 0x10));
	}
}

function variableStore(state, variable, value) {
	if (variable === 0) {
		const frame = state.stack[state.stack.length - 1];
		frame.stack.push(value);
	} else if (variable <= 0x0F) {
		const frame = state.stack[state.stack.length - 1];
		frame.localVariables[variable - 1] = value;
	} else {
		write16(state.memory, getGlobalTableAddress(state) + 2 * (variable - 0x10), value);
	}
}

function decodeInstruction(state, address) {
	const startAddress = address;

	const result = { address };

	const opcodeByte = state.memory[address++];

	const form =
		(getVersion(state) >= 5 && opcodeByte === 0xBE) ? 'extended' :
		(opcodeByte & 0xC0) === 0xC0 ? 'variable' :
		(opcodeByte & 0xC0) === 0x80 ? 'short' :
		'long';

	const operandTypes = [];
	switch (form) {
		case 'short': {
			const is0OP = ((opcodeByte & 0x30) === 0x30);
			result.opcode = lookupOpcode(state, opcodeByte & 0x0F, is0OP ? '0OP' : '1OP');
			if (!is0OP) {
				operandTypes.push((opcodeByte >> 4) & 0x03);
			}
		} break;

		case 'long': {
			result.opcode = lookupOpcode(state, opcodeByte & 0x1F, '2OP');
			operandTypes.push((opcodeByte & 0x40) ? TYPE_VARIABLE : TYPE_SMALL_CONSTANT);
			operandTypes.push((opcodeByte & 0x20) ? TYPE_VARIABLE : TYPE_SMALL_CONSTANT);
		} break;

		case 'variable': {
			result.opcode = lookupOpcode(state, opcodeByte & 0x1F, (opcodeByte & 0x20) ? 'VAR' : '2OP');
		} break;

		case 'extended': {
			result.opcode = lookupOpcode(state, state.memory[address++], 'EXT');
		} break;
	}

	if (form === 'variable' || form === 'extended') {
		for (let shift = 6; shift >= 0; shift -= 2) {
			const type = (state.memory[address] >> shift) & 0x3;
			if (type == TYPE_OMITTED) {
				break;
			}
			operandTypes.push(type);
		}
		++address;

		if (operandTypes.length === 4 && result.opcode && (result.opcode.op === 'call_vs2' || result.opcode.op === 'call_vn2')) {
			for (let shift = 6; shift >= 0; shift -= 2) {
				const type = (state.memory[address] >> shift) & 0x3;
				if (type == TYPE_OMITTED) {
					break;
				}
				operandTypes.push(type);
			}
			++address;
		}
	}

	result.operands = operandTypes.map(type => {
		if (type === TYPE_LARGE_CONSTANT) {
			const value = read16(state.memory, address);
			address += 2;
			return { type: 'constant', value };
		} else if (type === TYPE_SMALL_CONSTANT) {
			return { type: 'constant', value: state.memory[address++] };
		} else {
			return { type: 'variable', value: state.memory[address++] };
		}
	});

	if (result.opcode && result.opcode.store) {
		result.resultVariable = state.memory[address++];
	}

	if (result.opcode && result.opcode.branch) {
		result.branchIf = !!(state.memory[address] & 0x80);
		if (state.memory[address] & 0x40) {
			result.branchOffset = state.memory[address++] & 0x3F;
			// expand sign from 8 bits to 16 bits
			if (result.branchOffset & 0x80) {
				result.branchOffset |= 0xFF00;
			}
		} else {
			result.branchOffset = (state.memory[address++] & 0x3F) << 8;
			result.branchOffset |= state.memory[address++];
			// expand sign from 14 bits to 16 bits
			if (result.branchOffset & 0x2000) {
				result.branchOffset |= 0xC000;
			}
		}
	}

	if (result.opcode && result.opcode.text) {
		const { text, nextAddress } = decodeText(state, address);
		result.text = text;
		address = nextAddress;
	}

	result.nextAddress = address;

	 // for debugging purposes only
	result.raw = state.memory.slice(startAddress, address);
	return result;
}

function executeInstruction(state, instruction, operands, output, input, random) {
	const op = instruction.opcode.op;
	switch (op) {
		case 'add': {
			/* add
				2OP:20 14 add a b -> (result)
				Signed 16-bit addition. */
			const value = (operands[0] + operands[1]) & 0xFFFF;
			variableStore(state, instruction.resultVariable, value);
		} break;

		case 'and': {
			/* and
				2OP:9 9 and a b -> (result)
				Bitwise AND. */
			const value = operands[0] & operands[1];
			variableStore(state, instruction.resultVariable, value);
		} break;

		case 'art_shift': {
			/* art_shift
				EXT:3 3 5/- art_shift number places -> (result)
				Does an arithmetic shift of number by the given number of places, shifting left (i.e. increasing)
				if places is positive, right if negative. In a right shift, the sign bit is preserved as well as being
				shifted on down. (The alternative behaviour is log_shift.) */
			const [number, places] = new Int16Array(operands);
			let value;
			if (places < 0) {
				value = (number >> (-places)) & 0xFFFF;
			} else {
				value = (number << places) & 0xFFFF;
			}
			variableStore(state, instruction.resultVariable, value);
		} break;

		case 'call_1n': {
			/* call_1n
				1OP:143 F 5 call_1n routine
				Executes routine() and throws away result. */
			performCall(state, op, operands[0], []);
		} break;

		case 'call_1s': {
			/* call_1s
				1OP:136 8 4 call_1s routine -> (result)
				Stores routine(). */
			performCall(state, op, operands[0], [], instruction.resultVariable);
		} break;

		case 'call_2n': {
			/* call_2n
				2OP:26 1A 5 call_2n routine arg1
				Executes routine(arg1) and throws away result. */
			performCall(state, op, operands[0], [operands[1]]);
		} break;

		case 'call_2s': {
			/* call_2s
				2OP:25 19 4 call_2s routine arg1 -> (result)
				Stores routine(arg1). */
			performCall(state, op, operands[0], [operands[1]], instruction.resultVariable);
		} break;

		case 'call_vn': {
			/* call_vn
				VAR:249 19 5 call_vn routine ...up to 3 args...
				Like call, but throws away result. */
			const [packedAddress, ...args] = operands;
			if (packedAddress !== 0) {
				performCall(state, op, packedAddress, args);
			}
		} break;

		case 'call':
		case 'call_vs': {
			/* call
				VAR:224 0 1 call routine ...up to 3 args... -> (result)
				The only call instruction in Version 3, Inform reads this as call_vs in higher versions: it calls the
				routine with 0, 1, 2 or 3 arguments as supplied and stores the resulting return value. (When the
				address 0 is called as a routine, nothing happens and the return value is false.) */
			/* call_vs
				VAR:224 0 4 call_vs routine ...up to 3 args... -> (result)
				See call. */
			const [packedAddress, ...args] = operands;
			if (packedAddress === 0) {
				variableStore(state, instruction.resultVariable, 0);
			} else {
				performCall(state, op, packedAddress, args, instruction.resultVariable);
			}
		} break;

		case 'check_arg_count': {
			/* check_arg_count
				VAR:255 1F 5 check_arg_count argument-number
				Branches if the given argument-number (counting from 1) has been provided by the routine call
				to the current routine. (This allows routines in Versions 5 and later to distinguish between the
				calls routine(1) and routine(1,0), which would otherwise be impossible to tell apart.) */
			const count = state.stack[state.stack.length - 1].argumentCount;
			const test = operands[0] === count;
			if (test === instruction.branchIf) {
				performBranch(state, instruction.branchOffset);
			}
		} break;

		case 'clear_attr': {
			/* clear_attr
				2OP:12 C clear_attr object attribute
				Make object not have the attribute numbered attribute. */
			setObjectAttribute(state, operands[0], operands[1], false);
		} break;

		case 'dec': {
			/* dec
				1OP:134 6 dec (variable)
				Decrement variable by 1. This is signed, so 0 decrements to -1. */
			let value = variableLoad(state, operands[0]);
			value = (value - 1) & 0xFFFF;
			variableStore(state, operands[0], value);
		} break;

		case 'dec_chk': {
			/* dec_chk
				2OP:4 4 dec_chk (variable) value ?(label)
				Decrement variable, and branch if it is now less than the given value. */
			let value = variableLoad(state, operands[0]);
			value = (value - 1) & 0xFFFF;
			variableStore(state, operands[0], value);

			let given = operands[1];
			[value, given] = new Int16Array([value, given]);
			const test = value < given;

			if (test === instruction.branchIf) {
				performBranch(state, instruction.branchOffset);
			}
		} break;

		case 'div': {
			/* div
				2OP:23 17 div a b -> (result)
				Signed 16-bit division. Division by zero should halt the interpreter with a suitable error message. */
			const [a, b] = new Int16Array(operands);
			const value = (a / b) & 0xFFFF;
			variableStore(state, instruction.resultVariable, value);
		} break;

		case 'get_child': {
			/* get_child
				1OP:130 2 get_child object -> (result) ?(label)
				Get first object contained in given object, branching if this exists, i.e. is not nothing (i.e., is not
				0). */
			const child = getObjectRelation(state, operands[0], RELATION_CHILD);
			variableStore(state, instruction.resultVariable, child);

			const test = child !== 0;
			if (test === instruction.branchIf) {
				performBranch(state, instruction.branchOffset);
			}
		} break;

		case 'get_next_prop': {
			/* get_next_prop
				2OP:19 13 get_next_prop object property -> (result)
				Gives the number of the next property provided by the quoted object. This may be zero, indicating
				the end of the property list; if called with zero, it gives the first property number present. It is
				illegal to try to find the next property of a property which does not exist, and an interpreter
				should halt with an error message (if it can efficiently check this condition). */
			const value = (operands[1] === 0) ?
				getObjectFirstPropertyNumber(state, operands[0]) :
				getObjectNextPropertyNumber(state, operands[0], operands[1]);
			variableStore(state, instruction.resultVariable, value);
		} break;

		case 'get_parent': {
			/* get_parent
				1OP:131 3 get_parent object -> (result)
				Get parent object (note that this has no "branch if exists" clause). */
			const parent = getObjectRelation(state, operands[0], RELATION_PARENT);
			variableStore(state, instruction.resultVariable, parent);
		} break;

		case 'get_prop': {
			/* get_prop
				2OP:17 11 get_prop object property -> (result)
				Read property from object (resulting in the default value if it had no such declared property). If
				the property has length 1, the value is only that byte. If it has length 2, the first two bytes of the
				property are taken as a word value. It is illegal for the opcode to be used if the property has
				length greater than 2, and the result is unspecified. */
			const data = getObjectPropertyData(state, operands[0], operands[1]);
			if (data) {
				variableStore(state, instruction.resultVariable, data.length === 1 ?
					data[0] :
					read16(data, 0));
			} else {
				variableStore(state, instruction.resultVariable, getDefaultPropertyData(state, operands[1]));
			}
		} break;

		case 'get_prop_addr': {
			/* get_prop_addr
				2OP:18 12 get_prop_addr object property -> (result)
				Get the byte address (in dynamic memory) of the property data for the given object's property.
				This must return 0 if the object hasn't got the property. */
			const address = getObjectPropertyDataAddress(state, operands[0], operands[1]);
			variableStore(state, instruction.resultVariable, address);
		} break;

		case 'get_prop_len': {
			/* get_prop_len
				1OP:132 4 get_prop_len property-address -> (result)
				Get length of property data (in bytes) for the given object's property. It is illegal to try to find the
				property length of a property which does not exist for the given object, and an interpreter should
				halt with an error message (if it can efficiently check this condition). */
			const length = getObjectPropertyDataLengthFromDataAddress(state, operands[0]);
			if (!length) {
				throw new Error(`object ${objectId} does not have property ${propertyId}`);
			}
			variableStore(state, instruction.resultVariable, length);
		} break;

		case 'get_sibling': {
			/* get_sibling
				1OP:129 1 get_sibling object -> (result) ?(label)
				Get next object in tree, branching if this exists, i.e. is not 0. */
			const sibling = getObjectRelation(state, operands[0], RELATION_SIBLING);
			variableStore(state, instruction.resultVariable, sibling);

			const test = sibling !== 0;
			if (test === instruction.branchIf) {
				performBranch(state, instruction.branchOffset);
			}
		} break;

		case 'inc': {
			/* inc
				1OP:133 5 inc (variable)
				Increment variable by 1. (This is signed, so -1 increments to 0.) */
			let value = variableLoad(state, operands[0]);
			value = (value + 1) & 0xFFFF;
			variableStore(state, operands[0], value);
		} break;

		case 'inc_chk': {
			/* inc_chk
				2OP:5 5 inc_chk (variable) value ?(label)
				Increment variable, and branch if now greater than value. */
			let value = variableLoad(state, operands[0]);
			value = (value + 1) & 0xFFFF;
			variableStore(state, operands[0], value);

			let given = operands[1];
			[value, given] = new Int16Array([value, given]);
			const test = value > given;

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
			moveObject(state, operands[0], operands[1]);
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

		case 'load': {
			/* load
				1OP:142 E load (variable) -> (result)
				The value of the variable referred to by the operand is stored in the result. (Inform doesn't use
				this; see the notes to S 14.) */
			const value = variableLoad(state, operands[0]);
			variableStore(state, instruction.resultVariable, value);
		} break;

		case 'loadb': {
			/* loadb
				2OP:16 10 loadb array byte-index -> (result)
				Stores array->byte-index (i.e., the byte at address array+byte-index, which must lie in static or
				dynamic memory). */
			const value = state.memory[(operands[0] + operands[1]) & 0xFFFF];
			variableStore(state, instruction.resultVariable, value);
		} break;

		case 'loadw': {
			/* loadw
				2OP:15 F loadw array word-index -> (result)
				Stores array-->word-index (i.e., the word at address array+2*word-index, which must lie in
				static or dynamic memory). */
			const value = read16(state.memory, (operands[0] + 2*operands[1]) & 0xFFFF);
			variableStore(state, instruction.resultVariable, value);
		} break;

		case 'log_shift': {
			/* log_shift
				EXT:2 2 5 log_shift number places -> (result)
				Does a logical shift of number by the given number of places, shifting left (i.e. increasing) if
				places is positive, right if negative. In a right shift, the sign is zeroed instead of being shifted on.
				(See also art_shift.) */
			const number = operands[0];
			const places = new Int16Array([operands[1]]);
			let value;
			if (places < 0) {
				value = (number >>> (-places)) & 0xFFFF;
			} else {
				value = (number << places) & 0xFFFF;
			}
			variableStore(state, instruction.resultVariable, value);
		} break;

		case 'mod': {
			/* mod
				2OP:24 18 mod a b -> (result)
				Remainder after signed 16-bit division. Division by zero should halt the interpreter with a suitable
				error message. */
			const [a, b] = new Int16Array(operands);
			const value = (a % b) & 0xFFFF;
			variableStore(state, instruction.resultVariable, value);
		} break;

		case 'mul': {
			/* mul
				2OP:22 16 mul a b -> (result)
				Signed 16-bit multiplication. */
			const value = (operands[0] * operands[1]) & 0xFFFF;
			variableStore(state, instruction.resultVariable, value);
		} break;

		case 'new_line': {
			/* new_line
				0OP:187 B new_line
				Print carriage return. */
			output.text += '\n';
		} break;

		case 'not': {
			/* not
				1OP:143 F 1/4 not value -> (result)
				VAR:248 18 5/6 not value -> (result)
				Bitwise NOT (i.e., all 16 bits reversed). Note that in Versions 3 and 4 this is a 1OP instruction,
				reasonably since it has 1 operand, but in later Versions it was moved into the extended set to
				make room for call_1n. */
			const value = ~(operands[0]) & 0xFFFF;
			variableStore(state, instruction.resultVariable, value);
		} break;

		case 'or': {
			/* or
				2OP:8 8 or a b -> (result)
				Bitwise OR. */
			const value = operands[0] | operands[1];
			variableStore(state, instruction.resultVariable, value);
		} break;

		case 'print': {
			/* print
				0OP:178 2 print
				Print the quoted (literal) Z-encoded string. */
			output.text += instruction.text;
		} break;

		case 'print_addr': {
			/* print_addr
				1OP:135 7 print_addr byte-address-of-string
				Print (Z-encoded) string at given byte address, in dynamic or static memory. */
			output.text += decodeText(state, operands[0]).text;
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
			output.text += getObjectName(state, operands[0]);
		} break;

		case 'print_paddr': {
			/* print_paddr
				1OP:141 D print_paddr packed-address-of-string
				Print the (Z-encoded) string at the given packed address in high memory. */
			const address = unpackAddress(state, op, operands[0]);
			const { text } = decodeText(state, address);
			output.text += text;
		} break;

		case 'print_ret': {
			/* print_ret
				0OP:179 3 print_ret
				Print the quoted (literal) Z-encoded string, then print a new-line and then return true (i.e., 1). */
			output.text += instruction.text + '\n';
			performReturn(state, 1);
		} break;

		case 'pull': {
			/* pull
				VAR:233 9 1 pull (variable)
				6 pull stack -> (result)
				Pulls value off a stack. (If the stack underflows, the interpreter should halt with a suitable error
				message.) In Version 6, the stack in question may be specified as a user one: otherwise it is the
				game stack. */
			const frame = state.stack[state.stack.length - 1];
			const value = frame.stack.pop();
			variableStore(state, operands[0], value);
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
			setObjectPropertyData(state, operands[0], operands[1], operands[2]);
		} break;

		case 'random': {
			/* random
				VAR:231 7 random range -> (result)
				If range is positive, returns a uniformly random number between 1 and range. If range is negative,
				the random number generator is seeded to that value and the return value is 0. Most interpreters
				consider giving 0 as range illegal (because they attempt a division with remainder by the
				range), but correct behaviour is to reseed the generator in as random a way as the interpreter can
				(e.g. by using the time in milliseconds).
				(Some version 3 games, such as 'Enchanter' release 29, had a debugging verb #random such that
				typing, say, #random 14 caused a call of random with -14.) */
			if (operands[0] > 0) {
				const value = random(operands[0]);
				variableStore(state, instruction.resultVariable, value);
			} else {
				// TODO seed rng
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
			input = input.toLowerCase().replace(/\n.*/g, '');
			parseText(state, input, operands[0], operands[1]);
			if (getVersion(state) >= 5) {
				variableStore(state, instruction.resultVariable, 10); // assume RETURN terminated this line
			}
		} break;

		case 'remove_obj': {
			/* remove_obj
				1OP:137 9 remove_obj object
				Detach the object from its parent, so that it no longer has any parent. (Its children remain in its
				possession.) */
			moveObject(state, operands[0], 0);
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
			performReturn(state, variableLoad(state, 0));
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

		case 'save_undo': {
			/* save_undo
				EXT:9 9 5 save_undo -> (result)
				Like save, except that the optional parameters may not be specified: it saves the game into a
				cache of memory held by the interpreter. If the interpreter is unable to provide this feature, it
				must return -1: otherwise it returns the save return value.
				It is illegal to use this opcode within an interrupt routine (one called asynchronously by a sound
				effect, or keyboard timing, or newline counting).
				(This call is typically needed once per turn, in order to implement "UNDO", so it needs to be
				quick.) */
			// TODO
			variableStore(state, instruction.resultVariable, (-1)&0xFFFF);
		} break;

		case 'set_attr': {
			/* set_attr
				2OP:11 B set_attr object attribute
				Make object have the attribute numbered attribute. */
			setObjectAttribute(state, operands[0], operands[1], true);
		} break;

		case 'set_text_style': {
			/* set_text_style
				VAR:241 11 4 set_text_style style
				Sets the text style to: Roman (if 0), Reverse Video (if 1), Bold (if 2), Italic (4), Fixed Pitch (8). In
				some interpreters (though this is not required) a combination of styles is possible (such as reverse
				video and bold). In these, changing to Roman should turn off all the other styles currently set. */
			// not implemented
		} break;

		case 'store': {
			/* store
				2OP:13 D store (variable) value
				Set the VARiable referenced by the operand to value. */
			variableStore(state, operands[0], operands[1]);
		} break;

		case 'storeb': {
			/* storeb
				VAR:226 2 storeb array byte-index value
				array->byte-index = value, i.e. stores the given value in the byte at address array+byte-index
				(which must lie in dynamic memory). (See loadb.) */
			const address = (operands[0] + operands[1]) & 0xFFFF;
			state.memory[address] = operands[2];
		} break;

		case 'storew': {
			/* storew
				VAR:225 1 storew array word-index value
				array-->word-index = value, i.e. stores the given value in the word at address array+2*wordindex
				(which must lie in dynamic memory). (See loadw.) */
			const address = (operands[0] + 2*operands[1]) & 0xFFFF;
			write16(state.memory, address, operands[2]);
		} break;

		case 'sub': {
			/* sub
				2OP:21 15 sub a b -> (result)
				Signed 16-bit subtraction. */
			const value = (operands[0] - operands[1]) & 0xFFFF;
			variableStore(state, instruction.resultVariable, value);
		} break;

		case 'test': {
			/* test
				2OP:7 7 test bitmap flags ?(label)
				Jump if all of the flags in bitmap are set (i.e. if bitmap & flags == flags). */
			const test = (operands[0] & operands[1]) === operands[1];
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

module.exports = run;
