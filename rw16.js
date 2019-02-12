function s8(value) {
	return new Int8Array([value])[0];
}

function s16(value) {
	return new Int16Array([value])[0];
}

function read16(buffer, address) {
	return buffer[address] << 8 | buffer[address + 1];
}

function write16(buffer, address, value) {
	buffer[address + 0] = (value >> 8) & 0xFF;
	buffer[address + 1] = (value >> 0) & 0xFF;
}

module.exports = {
	s8,
	s16,
	read16,
	write16
};
