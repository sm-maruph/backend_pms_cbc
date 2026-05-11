exports.getAllUsers = async (req, res) => { res.json([]); };
exports.createUser = async (req, res) => { res.status(201).json({ message: 'User created' }); };
exports.updateUser = async (req, res) => { res.json({ message: 'User updated' }); };
exports.deleteUser = async (req, res) => { res.json({ message: 'User deleted' }); };
