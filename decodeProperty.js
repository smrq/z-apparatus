const { getVersion } = require('./header');

module.exports = function decodeProperty(state, address) {
	let dataAddress = address;
	const sizeByte = state.memory[dataAddress++];
	if (sizeByte === 0) {
		return null;
	}

	let number, dataLength;
	if (getVersion(state) <= 3) {
		number = sizeByte & 0x1F;
		dataLength = (sizeByte >> 5) + 1;
	} else {
		number = sizeByte & 0x3F;
		if (sizeByte & 0x80) {
			dataLength = (state.memory[dataAddress++] & 0x3F) || 64;
		} else if (sizeByte & 0x40) {
			dataLength = 2;
		} else {
			dataLength = 1;
		}
	}

	return { number, address, dataAddress, dataLength, data: state.memory.slice(dataAddress, dataAddress + dataLength) };
}
