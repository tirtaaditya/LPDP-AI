function success(res, data, statusCode = 200) {
  return res.status(statusCode).json({
    status: 'success',
    data,
  });
}

function failure(res, message, statusCode = 400, data = null) {
  return res.status(statusCode).json({
    status: 'error',
    data,
    message,
  });
}

module.exports = { success, failure };
