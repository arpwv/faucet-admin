const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const fetch = require('isomorphic-fetch');
const authenticate = require('../helpers/middleware').authenticate;

const elements = 25;

class AppError extends Error {
  constructor({ type = 'error_api_general', status = 400, cause }) {
    super(`${type}`);
    this.type = type;
    this.status = status;
    this.cause = cause;
  }
  toJSON() {
    return { type: this.type };
  }
}

function routeMiddleware(handler) {
  return (req, res) => {
    handler(req, res).then((result) => {
      if(result.view) {
        res.render(result.view, result.data);
      } else {
        res.json(result.data);
      }
    }).catch((error) => {
      let err = error;
      if (!(err instanceof AppError)) {
        err = new AppError({ type: 'error_api_general', status: 500, cause: err });
      }
      if (err.status >= 500) {
        req.log.error(err.cause || err, 'Unexpected App error');
      } else if (error.status >= 400) {
        req.log.warn(err.cause || err, 'App Error: %s', err.type);
      }
      res.status(err.status);
      res.render('error', { error: err });
    });
  };
}

/* GET home page. */
router.get('/', (req, res, next) => {
  res.render('index', { title: 'Log in to continue' });
});

router.get('/.well-known/healthcheck.json', (req, res) => {
  res.json({ ok: true, date: new Date().toISOString() });
});

router.get('/dashboard', authenticate(), routeMiddleware(async (req) => {
  const ongoing = await req.db.users
    .count({ where: { status: null } });
  const rejected = await req.db.users
    .count({ where: { status: 'rejected' } });
  const approved = await req.db.users
    .count({ where: { status: 'approved' } });
  const pending = await req.db.users
    .count({ where: { status: 'manual_review' } });
  const created = await req.db.users
    .count({ where: { status: 'created' } });
  const all = await req.db.users
    .count();
  return {
    view: 'dashboard',
    data: {
      title: 'Dashboard',
      ongoing,
      approved,
      rejected,
      pending,
      created,
      all
    }
  };
}));

router.get('/user/:id', authenticate(), routeMiddleware(async (req) => {
  const user = await req.db.users.findOne({
    where: { id: req.params.id }
  });
  return {
    view: 'user',
    data: {
      title: 'User details',
      user
    }
  }
}));

router.get('/users/ongoing', authenticate(), routeMiddleware(async (req) => {
  return listUser(req, {
    location: 'users/ongoing',
    showActions: false,
    title: 'Ongoing users',
    where: { status: null }
  });
}));

router.get('/users/pending', authenticate(), routeMiddleware(async (req) => {
  return listUser(req, {
    location: 'users/pending',
    showActions: true,
    title: 'Pending approval users',
    where: { status: 'manual_review' }
  });
}));

router.get('/users/approved', authenticate(), routeMiddleware(async (req) => {
  return listUser(req, {
    location: 'users/approved',
    showActions: false,
    title: 'Approved users',
    where: { status: 'approved' }
  });
}));

router.get('/users/rejected', authenticate(), routeMiddleware(async (req) => {
  return listUser(req, {
    location: 'users/rejected',
    showActions: true,
    title: 'Rejected users',
    where: { status: 'rejected' }
  });
}));

router.get('/users/created', authenticate(), routeMiddleware(async (req) => {
  return listUser(req, {
    location: 'users/created',
    showActions: false,
    title: 'Created users',
    where: { status: 'created' }
  });
}));

router.get('/users/all', authenticate(), routeMiddleware(async (req) => {
  return listUser(req, {
    location: 'users/all',
    showActions: false,
    title: 'All users',
    where: { }
  });
}));

const listUser = async(req, options) => {
  const page = parseInt(req.query.page) || 1;
  const count = await req.db.users.count({ where: options.where });

  const users = await req.db.users.findAll(
    {
      order: [['updated_at', 'DESC']],
      offset: parseInt((page - 1) * elements),
      limit: elements,
      where: options.where
    }
  );

  return {
    view: 'users',
    data: {
      page: page,
      showLast: count > page * elements,
      location: options.location,
      showActions: options.showActions,
      title: options.title,
      users: users
    }
  };
};


router.post('/approve', authenticate(), routeMiddleware(async (req) => {
  const users = await req.db.users.findAll({ where: { id: req.body['ids[]'] } });

  const emails = [];
  for(let i = 0; i < users.length; i += 1) {
    emails.push(users[i].email);
  }
  const token = jwt.sign({
    emails,
  }, process.env.JWT_SECRET, { expiresIn: '1d' });
  const result = await fetch(`${process.env.FAUCET_URL}/api/approve_account?token=${token}`)
    .then(function(response) {
      return response.json();
    });
    if(result.success) {
      await req.db.users.update({
        status: 'approved',
      }, { where: { id: req.body['ids[]'] } });
    }
    return {
      data: {
        success: result.success,
        errors: result.errors,
        ids: req.body['ids[]'],
      }
    };
}));

router.post('/reject', authenticate(), routeMiddleware(async (req) => {
  req.db.users.update({
    status: 'rejected',
  }, { where: { id: req.body['ids[]'] } });
  return {
    data: {
      success: true,
      ids: req.body['ids[]'],
    }
  }
}));

module.exports = router;
