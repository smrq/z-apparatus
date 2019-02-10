const { getVersion } = require('./header');
const decodeText = require('./decodeText');

module.exports = function decodePropertyTable(state, address) {
	const shortNameLength = state.memory[address];
	const shortName = decodeText(state, address + 1).text;
	address = address + 1 + (shortNameLength * 2);

	const properties = [];

	for (;;) {
		let number, length;

		const sizeByte = state.memory[address++];
		if (sizeByte === 0) {
			break;
		}

		if (getVersion(state) <= 3) {
			number = sizeByte & 0x1F;
			length = (sizeByte >> 5) + 1;
		} else {
			number = sizeByte & 0x3F;
			if (sizeByte & 0x80) {
				length = (state.memory[address++] & 0x3F) || 64;
			} else if (sizeByte & 0x40) {
				length = 2;
			} else {
				length = 1;
			}
		}

		properties.push({ number, address, data: state.memory.slice(address, length) });
		address += length;
	}

	return {
		shortName,
		properties
	};
}
