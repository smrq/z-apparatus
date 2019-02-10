const { getVersion } = require('./header');
const { read16 } = require('./rw16');

module.exports = function decodeRoutine(state, address) {
	const localVariableCount = state.memory[address++];
	const localVariables = [];

	for (let i = 0; i < localVariableCount; ++i) {
		if (getVersion(state) <= 4) {
			localVariables.push(read16(state.memory, address));
			address += 2;
		} else {
			localVariables.push(0);
		}
	}

	return {
		localVariables,
		firstInstructionAddress: address
	};
}
