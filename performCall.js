const decodeRoutine = require('./decodeRoutine');
const unpackAddress = require('./unpackAddress');

module.exports = function performCall(state, op, packedAddress, args, resultVariable = null) {
	const address = unpackAddress(state, op, packedAddress);
	const { localVariables, firstInstructionAddress } = decodeRoutine(state, address);

	args.forEach((arg, i) => {
		if (localVariables.length > i) {
			localVariables[i] = args[i];
		}
	});

	const stackFrame = {
		stack: [],
		argumentCount: args.length,
		localVariables,
		resultVariable,
		nextAddress: state.pc
	};
	state.stack.push(stackFrame);
	state.pc = firstInstructionAddress;
}
