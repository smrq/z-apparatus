const { getVersion } = require('./header');
const decodeText = require('./decodeText');
const decodeProperty = require('./decodeProperty');

module.exports = function decodePropertyTable(state, address) {
	const shortNameLength = state.memory[address];
	const shortName = decodeText(state, address + 1).text;
	address = address + 1 + (shortNameLength * 2);

	const properties = [];

	for (;;) {
		const property = decodeProperty(state, address);
		if (!property) {
			break;
		}
		properties.push(property);
		address = property.dataAddress + property.dataLength;
	}

	return {
		shortName,
		properties
	};
}
