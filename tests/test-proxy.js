'use strict'

var server = require('./server')
  , request = require('../index')
  , tape = require('tape')

var s = server.createServer()
  , currResponseHandler

function handleRequest(req, res) {
  currResponseHandler(req, res)
  res.writeHeader(200)
  res.end('ok')
}
s.on('http://google.com/', handleRequest)
s.on('https://google.com/', handleRequest)

var proxyEnvVars = [
  'http_proxy',
  'HTTP_PROXY',
  'https_proxy',
  'HTTPS_PROXY',
  'no_proxy',
  'NO_PROXY'
]

// Set up and run a proxy test.  All environment variables pertaining to
// proxies will be deleted before each test.  Specify environment variables as
// `options.env`; all other keys on `options` will be passed as additional
// options to `request`.
//
// If `responseHandler` is a function, it should perform asserts on the server
// response.  It will be called with parameters (t, req, res).  Otherwise,
// `responseHandler` should be truthy to indicate that the proxy should be used
// for this request, or falsy to indicate that the proxy should not be used for
// this request.
function runTest(name, options, responseHandler) {
  tape(name, function(t) {
    proxyEnvVars.forEach(function(v) {
      delete process.env[v]
    })
    if (options.env) {
      for (var v in options.env) {
        process.env[v] = options.env[v]
      }
      delete options.env
    }

    var called = false
    currResponseHandler = function(req, res) {
      if (responseHandler) {
        called = true
        t.equal(req.headers.host, 'google.com')
        if (typeof responseHandler === 'function') {
          responseHandler(t, req, res)
        }
      } else {
        t.fail('proxy response should not be called')
      }
    }

    var requestOpts = {
      url: 'http://google.com'
    }
    for (var k in options) {
      requestOpts[k] = options[k]
    }

    request(requestOpts, function(err, res, body) {
      if (responseHandler && !called) {
        t.fail('proxy response should be called')
      }
      t.equal(err, null)
      t.equal(res.statusCode, 200)
      if (responseHandler) {
        if (body.length > 100) {
          body = body.substring(0, 100)
        }
        t.equal(body, 'ok')
      } else {
        t.equal(/^<!doctype html>/i.test(body), true)
      }
      t.end()
    })
  })
}

tape('setup', function(t) {
  s.listen(s.port, function() {
    t.end()
  })
})


// If the `runTest` function is changed, run the following command and make
// sure both of these tests fail:
//
//   TEST_PROXY_HARNESS=y node tests/test-proxy.js

if (process.env.TEST_PROXY_HARNESS) {

  runTest('should fail with "proxy response should not be called"', {
    proxy : s.url
  }, false)

  runTest('should fail with "proxy response should be called"', {
    proxy : null
  }, true)

} else {
  // Run the real tests

  runTest('basic proxy', {
    proxy   : s.url,
    headers : {
      'proxy-authorization': 'Token Fooblez'
    }
  }, function(t, req, res) {
    t.equal(req.headers['proxy-authorization'], 'Token Fooblez')
  })

  runTest('proxy auth without uri auth', {
    proxy : 'http://user:pass@localhost:' + s.port
  }, function(t, req, res) {
    t.equal(req.headers['proxy-authorization'], 'Basic dXNlcjpwYXNz')
  })

  runTest('HTTP_PROXY environment variable', {
    env : { HTTP_PROXY : s.url }
  }, true)

  runTest('http_proxy environment variable', {
    env : { http_proxy : s.url }
  }, true)

  runTest('http_proxy with length of one more than the URL', {
    env: {
      HTTP_PROXY : s.url,
      NO_PROXY: 'elgoog1.com' // one more char than google.com
    }
  }, true)

  runTest('NO_PROXY hostnames are case insensitive', {
    env : {
      HTTP_PROXY : s.url,
      NO_PROXY   : 'GOOGLE.COM'
    }
  }, false)

  runTest('NO_PROXY ignored with explicit proxy passed', {
    env   : { NO_PROXY : '*' },
    proxy : s.url
  }, true)

  runTest('NO_PROXY overrides HTTP_PROXY for specific hostname', {
    env : {
      HTTP_PROXY : s.url,
      NO_PROXY   : 'google.com'
    }
  }, false)

  runTest('no_proxy overrides HTTP_PROXY for specific hostname', {
    env : {
      HTTP_PROXY : s.url,
      no_proxy   : 'google.com'
    }
  }, false)

  runTest('NO_PROXY does not override HTTP_PROXY if no hostnames match', {
    env : {
      HTTP_PROXY : s.url,
      NO_PROXY   : 'foo.bar,bar.foo'
    }
  }, true)

  runTest('NO_PROXY overrides HTTP_PROXY if a hostname matches', {
    env : {
      HTTP_PROXY : s.url,
      NO_PROXY   : 'foo.bar,google.com'
    }
  }, false)

  runTest('NO_PROXY allows an explicit port', {
    env : {
      HTTP_PROXY : s.url,
      NO_PROXY   : 'google.com:80'
    }
  }, false)

  runTest('NO_PROXY only overrides HTTP_PROXY if the port matches', {
    env : {
      HTTP_PROXY : s.url,
      NO_PROXY   : 'google.com:1234'
    }
  }, true)

  runTest('NO_PROXY=* should override HTTP_PROXY for all hosts', {
    env : {
      HTTP_PROXY : s.url,
      NO_PROXY   : '*'
    }
  }, false)

  runTest('NO_PROXY should override HTTP_PROXY for all subdomains', {
    env : {
      HTTP_PROXY : s.url,
      NO_PROXY   : 'google.com'
    },
    headers : { host : 'www.google.com' }
  }, false)

  runTest('NO_PROXY should not override HTTP_PROXY for partial domain matches', {
    env : {
      HTTP_PROXY : s.url,
      NO_PROXY   : 'oogle.com'
    }
  }, true)

  runTest('NO_PROXY with port should not override HTTP_PROXY for partial domain matches', {
    env : {
      HTTP_PROXY : s.url,
      NO_PROXY   : 'oogle.com:80'
    }
  }, true)

  runTest('proxy: null should override HTTP_PROXY', {
    env     : { HTTP_PROXY : s.url },
    proxy   : null,
    timeout : 500
  }, false)

  runTest('uri auth without proxy auth', {
    url   : 'http://user:pass@google.com',
    proxy : s.url
  }, function(t, req, res) {
    t.equal(req.headers['proxy-authorization'], undefined)
    t.equal(req.headers.authorization, 'Basic dXNlcjpwYXNz')
  })

  // runTest('proxy https over http', {
  //   url    : 'https://google.com',
  //   proxy  : s.url,
  //   tunnel : false
  // }, true)

  tape('proxy https over http defaults to tunnelling', function(t) {
    var receivedConnection = false;
    function onConnect(req, socket, head) {
      s.removeListener('connect', onConnect);
      console.log('received');
      socket.write('HTTP/1.1 204 NO CONTENT');
      console.log(socket.write + '');
      socket.write('Server: nginx');
      socket.write('Date: Thu, 08 Jan 2015 18:09:39 GMT');
      socket.write('Content-Type: text/html');
      socket.write('Content-Length: 0');
      socket.write('Last-Modified: Wed, 24 Dec 2014 01:30:25 GMT');
      socket.write('Accept-Ranges: bytes');
      socket.write('Proxy-Connection: Keep-alive');
      socket.end();
      receivedConnection = true;
    }
    s.on('connect', onConnect)
    request({
      url    : 'https://google.com',
      proxy  : s.url
    }, function (err, res, body) {
      t.equal(err, null)
      t.equal(res.statusCode, 200)
      process.nextTick(function () {
        t.equal(receivedConnection, true);
        t.end();
      });
    });
  });
}



tape('cleanup', function(t) {
  s.close()
  t.end()
})
