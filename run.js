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

	// debuglog(instructionToString(instruction));

	if (instruction.opcode.input && input == null) {
		return true;
	}

	const operands = instruction.operands.map(op => performDereference(state, op));

	// debuglog('        [' + operands.map(op => op.toString(16).padStart(4, 0)).join(' ') + ']');
	// debuglog(state.stack);

	state.pc = instruction.nextAddress;

	const result = executeInstruction(state, instruction, operands, output, input);

// 	if (state.pc === 0x590c || state.pc === 0x5910) {
// 		console.log('[2551] ' + state.memory.slice(0x2551, 0x2561).map(x => x.toString(16).padStart(2, '0')).join(' '));
// 		console.log('[2641] ' + state.memory.slice(0x2641, 0x2651).map(x => x.toString(16).padStart(2, '0')).join(' '));
// 	}
//
// 	if (state.pc === 0x5910) {
// 		throw new Error("STOP")
// 	}

	return result;
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
