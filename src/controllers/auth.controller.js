const authService = require('../services/auth.service');
const { success, failure } = require('../utils/response');

async function login(req, res) {
  const { username, password } = req.body || {};

  if (!username || !password) {
    return failure(res, 'username and password are required', 400);
  }

  const result = await authService.loginApiUser(username, password);
  if (!result) {
    return failure(res, 'Invalid username or password', 401);
  }

  return success(res, result);
}

module.exports = { login };
