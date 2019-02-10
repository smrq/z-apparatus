const decodeInstruction = require('./decodeInstruction');
const executeInstruction = require('./executeInstruction');
const performDereference = require('./performDereference');

let DEBUG = true;
const debuglog = function() { if (DEBUG) { console.log.apply(console, arguments); }}

module.exports = function run(state, output, input) {
	const instruction = decodeInstruction(state, state.pc);
	if (!instruction.opcode) {
		throw new Error(`invalid instruction at 0x${state.pc.toString(16)}`);
	}

	debuglog(instructionToString(instruction));

	if (instruction.opcode.input && input == null) {
		return true;
	}

	const operands = instruction.operands.map(op => performDereference(state, op));

	// debuglog('        [' + operands.map(op => op.toString(16).padStart(4, 0)).join(' ') + ']');
	// debuglog(state.stack);

	state.pc = instruction.nextAddress;

	return executeInstruction(state, instruction, operands, output, input);
}

function instructionToString(instruction) {
	let result = `0x${instruction.address.toString(16).padStart(4, 0)}: `;
	if (!instruction.opcode) {
		result += '[invalid opcode]';
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
