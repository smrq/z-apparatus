const decodeVariable = require('./decodeVariable');
const decodeText = require('./decodeText');
const { getVersion } = require('./header');
const lookupOpcode = require('./lookupOpcode');
const { read16 } = require('./rw16');

const TYPE_LARGE_CONSTANT = 0x0;
const TYPE_SMALL_CONSTANT = 0x1;
const TYPE_VARIABLE = 0x2;
const TYPE_OMITTED = 0x3;

module.exports = function decodeInstruction(state, address) {
	const result = { address };

	const opcodeByte = state.memory[address++];

	const form =
		(opcodeByte & 0xC0) === 0xC0 ? 'variable' :
		(opcodeByte & 0xC0) === 0x80 ? 'short' :
		(getVersion(state) >= 5 && opcodeByte === 0xBE) ? 'extended' :
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
			result.opcode = lookupOpcode(state, state.memory[address++], 'VAR');
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
			return { type: 'largeconstant', value };
		} else if (type === TYPE_SMALL_CONSTANT) {
			return { type: 'smallconstant', value: state.memory[address++] };
		} else {
			return decodeVariable(state.memory[address++]);
		}
	});

	if (result.opcode && result.opcode.store) {
		result.resultVariable = decodeVariable(state.memory[address++]);
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
	return result;
}
