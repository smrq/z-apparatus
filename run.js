const decodeInstruction = require('./decodeInstruction');
const executeInstruction = require('./executeInstruction');
const { variableLoad } = require('./variables');
const { s16 } = require('./rw16');

module.exports = function run(state, output, input, random) {
	const instruction = decodeInstruction(state, state.pc);
	if (!instruction.opcode) {
		throw new Error(`invalid instruction at 0x${state.pc.toString(16)}`);
	}

	// console.error(instructionToString(instruction));

	if (instruction.opcode.input && input == null) {
		return 'yield';
	}

	if (instruction.opcode.op === 'quit') {
		return 'quit';
	}

	const operands = instruction.operands.map(operand => operand.type === 'constant' ?
			operand.value :
			variableLoad(state, operand.value));

	// console.error('  (' + operands.map(op => op && op.toString(16).padStart(4, 0)).join(' ') + ')');
	// console.error(state.stack);

	// function debugOperand(operand) {
	// 	if (typeof operand === 'number') {
	// 		return operand.toString(16).padStart(4, '0');
	// 	} else {
	// 		return operand;
	// 	}
	// }

	// console.error('<' +
	// 	instruction.address.toString(16).padStart(6, '0') + ' ' +
	// 	instruction.opcodeByte.toString(16).padStart(2, '0') + ' ' +
	// 	operands.length + ' ' +
	// 	debugOperand(operands.length > 0 ? operands[0] : 0) + ' ' +
	// 	debugOperand(operands.length > 1 ? operands[1] : 0) + ' ' +
	// 	debugOperand(operands.length > 2 ? operands[2] : 0) + ' ' +
	// 	debugOperand(operands.length > 3 ? operands[3] : 0) + '> | ' +
	// 	(state.stack[state.stack.length-1].stack.slice(-1)[0] || 0).toString(16).padStart(4, '0') + ' | ' +
	// 	(state.stack[state.stack.length-1].localVariables ? state.stack[state.stack.length-1].localVariables.map(l => l.toString(16).padStart(4, '0') + ' ').join('') : '')
	// );

	state.pc = instruction.nextAddress;

	const result = executeInstruction(state, instruction, operands, output, input, random);

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
	let result = `0x${instruction.address.toString(16).padStart(4, '0')}: <`;
	result += instruction.raw.map(byte => byte.toString(16).padStart(2, '0')).join(' ') + '>  ';
	if (!instruction.opcode) {
		result += '[invalid opcode]';
	} else {
		if (instruction.opcode.store) {
			result += `${operandToString({ type: 'variable', value: instruction.resultVariable })} = `;
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
	if (operand.type === 'constant') {
		return `0x${operand.value.toString(16).padStart(4, 0)}`;
	} else if (operand.value === 0) {
		return '(stack)';
	} else if (operand.value <= 0x0F) {
		return `L${(operand.value - 1).toString(16)}`;
	} else {
		return `G${(operand.value - 0x0F).toString(16)}`;
	}
}
