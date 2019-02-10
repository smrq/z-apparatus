function read16(buffer, address) {
	return buffer[address] << 8 | buffer[address + 1];
}

function write16(buffer, address, value) {
	buffer[address + 0] = (value >> 8) & 0xFF;
	buffer[address + 1] = (value >> 0) & 0xFF;
}

module.exports = {
	read16,
	write16
};
