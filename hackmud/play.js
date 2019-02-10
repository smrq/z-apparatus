function ({ caller }, args) {
	const { load, cmd } = JSON.parse(JSON.stringify(args));

	if (load) {
		const data = #db.f({ type: 'story', name: load }).first();
		if (!data) {
			return `Story ${load} was not found.`;
		}

		#db.us({ type: 'ram', user: caller }, {
			state: data.initialState
		});

		return `Story ${load} loaded.`;
	}

	const data = #db.f({ type: 'ram', user: caller }).first();
	if (!data) {
		return `No story is loaded.`;
	}

	const { state } = data;

	// TODO
}
