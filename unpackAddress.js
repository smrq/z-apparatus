const { getVersion, getStaticStringsOffset, getRoutinesOffset } = require('./header');

module.exports = function unpackAddress(state, op, packedAddress) {
	if (getVersion(state) <= 3) {
		return packedAddress * 2;
	}
	if (getVersion(state) <= 5) {
		return packedAddress * 4;
	}
	if (getVersion(state) <= 7) {
		if (op === 'print_paddr') {
			return packedAddress * 4 + getStaticStringsOffset(state);
		} else {
			return packedAddress * 4 + getRoutinesOffset(state);
		}
	}
	return packedAddress * 8;
}
