module.exports = function lookupOpcode(state, code, operandCount) {
	return state.opcodeTable.find(entry =>
		entry.code === code &&
		entry.operandCount === operandCount);
}
