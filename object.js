const { getVersion, getObjectTableAddress } = require('./header');
const { read16 } = require('./rw16');

const RELATION_PARENT = 0;
const RELATION_SIBLING = 1;
const RELATION_CHILD = 2;

function getDefaultProperty(state, propertyId) {
	const version = getVersion(state);
	const maxPropertyId = version <= 3 ? 32 : 64;

	if (propertyId > maxPropertyId || propertyId < 1) {
		throw new Error(`tried to read invalid default property id ${propertyId}`);
	}

	const base = getObjectTableAddress(state);
	const address = base + 2 * (propertyId - 1);
	return read16(state.memory, address);
}

function getObjectBase(state, objectId) {
	const version = getVersion(state);
	const maxObjectId = version <= 3 ? 255 : 65535;

	if (objectId > maxObjectId || objectId < 1) {
		throw new Error(`tried to find invalid object id ${objectId}`);
	}

	const maxPropertyId = version <= 3 ? 32 : 64;
	const objectSize = version <= 3 ? 9 : 14;

	return getObjectTableAddress(state) + 2 * (maxPropertyId - 1) + objectSize * (objectId - 1);
}

function getAttributeBase(state, objectId, attributeId) {
	const version = getVersion(state);
	const base = getObjectBase(state, objectId);

	const maxAttributeId = version <= 3 ? 32 : 48;
	if (attributeId >= maxAttributeId || attributeId < 0) {
		throw new Error(`tried to find invalid attribute id ${attributeId}`);
	}

	const address = base + (attributeId >> 3);
	const bit = 7 - (attributeId & 0x7);
	return [address, bit];
}

function getObjectAttribute(state, objectId, attributeId) {
	const [address, bit] = getAttributeBase(state, objectId, attributeId);
	return !!(state.memory[address] & (1 << bit));
}

function setObjectAttribute(state, objectId, attributeId, value) {
	const [address, bit] = getAttributeBase(state, objectId, attributeId);
	if (value) {
		state.memory[address] |= (1 << bit);
	} else {
		state.memory[address] &= ~(1 << bit);
	}
}

function getObjectRelation(state, objectId, relationNumber) {
	const version = getVersion(state);
	const base = getObjectBase(state, objectId);
	return version <= 3 ?
		state.memory[base + 4 + relationNumber] :
		read16(state.memory, base + 6 + 2 * relationNumber);
}

function setObjectRelation(state, objectId, relationNumber, relation) {
	const version = getVersion(state);
	const base = getObjectBase(state, objectId);
	if (version <= 3) {
		state.memory[base + 4 + relationNumber] = relation;
	} else {
		write16(state.memory, base + 6 + 2 * relationNumber, relation);
	}
}

function getObjectPropertiesAddress(state, objectId) {
	const version = getVersion(state);
	const base = getObjectBase(state, objectId);
	return read16(state.memory, base + (version <= 3 ? 7 : 12));
}

function setObjectPropertiesAddress(state, objectId, address) {
	const version = getVersion(state);
	const base = getObjectBase(state, objectId);
	write16(state.memory, base + (version <= 3 ? 7 : 12), address);
}

module.exports = {
	RELATION_PARENT,
	RELATION_SIBLING,
	RELATION_CHILD,
	getDefaultProperty,
	getObjectAttribute,
	setObjectAttribute,
	getObjectRelation,
	setObjectRelation,
	getObjectPropertiesAddress,
	setObjectPropertiesAddress
};
