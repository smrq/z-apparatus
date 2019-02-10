const performStore = require('./performStore');

module.exports = function performReturn(state, value) {
	const frame = state.stack.pop();
	if (frame.resultVariable) {
		performStore(state, frame.resultVariable, value);
	}
	state.pc = frame.nextAddress;
}
