const { variableStore } = require('./variables');

module.exports = function performReturn(state, value) {
	const frame = state.stack.pop();
	if (frame.resultVariable != null) {
		variableStore(state, frame.resultVariable, value);
	}
	state.pc = frame.nextAddress;
}
