const unpackAddress = require('./unpackAddress');
const { getVersion } = require('./header');
const { read16 } = require('./rw16');

module.exports = function performCall(state, op, packedAddress, args, resultVariable = null) {
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
