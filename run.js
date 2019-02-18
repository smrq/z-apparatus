const decodeInstruction = require('./decodeInstruction');
const executeInstruction = require('./executeInstruction');
const { variableLoad } = require('./variables');

module.exports = function run(state, output, input, random) {
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
	// debugInstruction(instruction);
	// debugOperands(operands);
	// debugZorkmid(state, instruction, operands);
	state.pc = instruction.nextAddress;
	return executeInstruction(state, instruction, operands, output, input, random);
}

function debugInstruction(instruction) {
	function opStr(operand) {
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
