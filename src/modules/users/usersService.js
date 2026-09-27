// d:\hoctaphk1nam4\DOANCHUYENNGANH\TOEIC\toeic_be\src\modules\users\usersService.js
const UsersModel = require("./usersModel");

async function list(params) {
  return UsersModel.list(params);
}

async function getById(id) {
  return UsersModel.getById(id);
}

async function update(id, data) {
  return UsersModel.update(id, data);
}

async function activate(id) {
  return UsersModel.setActive(id, true);
}

async function deactivate(id) {
  return UsersModel.setActive(id, false);
}

async function deleteUser(id) {
  return UsersModel.deleteUser(id);
}

module.exports = {
  list,
  getById,
  update,
  activate,
  deactivate,
  delete: deleteUser,
};
