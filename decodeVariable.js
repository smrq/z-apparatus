module.exports = function decodeVariable(variable) {
	if (variable === 0) {
		return { type: 'stack' };
	} else if (variable <= 0x0F) {
		return { type: 'local', index: variable - 0x01 };
	} else {
		return { type: 'global', index: variable - 0x10 };
	}
}
