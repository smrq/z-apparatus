const { getVersion, getObjectTableAddress } = require('./header');
const decodeText = require('./decodeText');
const { read16, write16 } = require('./rw16');

const RELATION_PARENT = 0;
const RELATION_SIBLING = 1;
const RELATION_CHILD = 2;

function getDefaultPropertyData(state, propertyId) {
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

function moveObject(state, obj, dest) {
	const parent = getObjectRelation(state, obj, RELATION_PARENT);
	if (parent !== 0) {
		const sibling = getObjectRelation(state, obj, RELATION_SIBLING);
		let node = getObjectRelation(state, parent, RELATION_CHILD);
		if (node === obj) {
			setObjectRelation(state, parent, RELATION_CHILD, sibling);
		} else {
			let nodeSibling = getObjectRelation(state, node, RELATION_SIBLING);
			while (nodeSibling !== obj) {
				node = nodeSibling;
				nodeSibling = getObjectRelation(state, node, RELATION_SIBLING);
			}
			setObjectRelation(state, node, RELATION_SIBLING, sibling);
		}
	}

	if (dest !== 0) {
		const destChild = getObjectRelation(state, dest, RELATION_CHILD);
		setObjectRelation(state, obj, RELATION_SIBLING, destChild);
		setObjectRelation(state, dest, RELATION_CHILD, obj);
	} else {
		setObjectRelation(state, obj, RELATION_SIBLING, 0);
	}

	setObjectRelation(state, obj, RELATION_PARENT, dest);
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

function getObjectName(state, objectId) {
	let address = getObjectPropertiesAddress(state, objectId);
	return decodeText(state, address + 1).text;
}

function getObjectFirstPropertyAddress(state, objectId) {
	let address = getObjectPropertiesAddress(state, objectId);
	return address + 1 + 2 * (state.memory[address]);
}

function getPropertyNumber(state, address) {
	if (state.memory[address] === 0) {
		return 0;
	} else if (getVersion(state) <= 3) {
		return state.memory[address] & 0x1F;
	} else {
		return state.memory[address] & 0x3F;
	}
}

function getPropertyDataAddress(state, address) {
	if ((getVersion(state) <= 3) || !(state.memory[address] & 0x80)) {
		return address + 1;
	} else {
		return address + 2;
	}
}

function getPropertyDataLength(state, address) {
	if (getVersion(state) <= 3) {
		return 1 + (state.memory[address] >> 5);
	} else if (state.memory[address] & 0x80) {
		return (state.memory[address + 1] & 0x3F) || 64;
	} else if (state.memory[address] & 0x40) {
		return 2;
	} else {
		return 1;
	}
}

function getObjectPropertyDataLengthFromDataAddress(state, address) {
	address -= 1;
	if (getVersion(state) <= 3) {
		return 1 + (state.memory[address] >> 5);
	} else if (state.memory[address] & 0x80) {
		return (state.memory[address] & 0x3F) || 64;
	} else if (state.memory[address] & 0x40) {
		return 2;
	} else {
		return 1;
	}
}

function getNextPropertyAddress(state, address) {
	return getPropertyDataAddress(state, address) + getPropertyDataLength(state, address);
}

function getObjectPropertyAddress(state, objectId, propertyId) {
	let address = getObjectFirstPropertyAddress(state, objectId);
	let id = getPropertyNumber(state, address);
	while (id > propertyId) {
		address = getNextPropertyAddress(state, address);
		id = getPropertyNumber(state, address);
	}
	if (id === propertyId) {
		return address;
	} else {
		return 0;
	}
}

function getObjectPropertyDataAddress(state, objectId, propertyId) {
	const address = getObjectPropertyAddress(state, objectId, propertyId);
	return address ? getPropertyDataAddress(state, address) : 0;
}

function getObjectPropertyData(state, objectId, propertyId) {
	const address = getObjectPropertyAddress(state, objectId, propertyId);
	if (!address) {
		return null;
	}
	const dataAddress = getPropertyDataAddress(state, address);
	const length = getPropertyDataLength(state, address);
	return state.memory.slice(dataAddress, dataAddress + length);
}

function getObjectFirstPropertyNumber(state, objectId) {
	const address = getObjectFirstPropertyAddress(state, objectId);
	return getPropertyNumber(state, address);
}

function getObjectNextPropertyNumber(state, objectId, propertyId) {
	const address = getObjectPropertyAddress(state, objectId, propertyId);
	if (address === 0) {
		throw new Error(`tried to get next prop for nonexistent prop ${propertyId} on object ${objectId}`);
	}
	const nextAddress = getNextPropertyAddress(state, address);
	return getPropertyNumber(state, nextAddress);
}

function setObjectPropertyData(state, objectId, propertyId, value) {
	const address = getObjectPropertyAddress(state, objectId, propertyId);
	if (address === 0) {
		throw new Error(`tried to set property data for nonexistent prop ${propertyId} on object ${objectId}`);
	}
	const dataAddress = getPropertyDataAddress(state, address);
	const dataLength = getPropertyDataLength(state, address);

	if (dataLength === 1) {
		state.memory[dataAddress] = value & 0xFF;
	} else {
		write16(state.memory, dataAddress, value);
	}
}

module.exports = {
	RELATION_PARENT,
	RELATION_SIBLING,
	RELATION_CHILD,
	getDefaultPropertyData,
	getObjectAttribute,
	setObjectAttribute,
	getObjectRelation,
	setObjectRelation,
	moveObject,
	getObjectName,
	getObjectPropertyData,
	getObjectPropertyDataAddress,
	getObjectPropertyDataLengthFromDataAddress,
	getObjectFirstPropertyNumber,
	getObjectNextPropertyNumber,
	setObjectPropertyData,
};
