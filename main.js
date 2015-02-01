var fs = require('fs');
var vm = require('vm');
var http = require('http');
var net = require('net');
var child_process = require('child_process');
var Bacon = require('baconjs');
var SSE = require('express-sse');

var opt = require('node-getopt').create([
  ['h', 'help', 'display this help'],
  ['v', 'version', 'show version'],
  ['p', 'port=PORT', 'listen port']
])
.bindHelp()
.parseSystem();

if (opt.options.version) {
    console.log('nwatchlive 0.0.1');
    process.exit();
}

var port = opt.options.port || 3050;

if (opt.argv.length == 0) {
    console.log('no services specified.');
    process.exit(1);
}

var watchers = {};

var watchHTTP = function(url) {
    return function(ack, err) {
        http.get(url, function(res) {
            if (res.statusCode == 200) {
                ack();
            } else {
                err("Received " + res.statusCode);
            }
        }).on('error', function(e) {
            err(e.message);
        });
    };
};

var watchTCP = function(host, port) {
    return function(ack, err) {
        var cte = false;
        var conn = net.createConnection({'host': host,
                                         'port': port},
                                        function() {
            ack();
            cte = true;
            conn.end();
        });
        conn.on('end', function() {
            if (!cte) {
                err('premature FIN');
            }
        });
        conn.on('timeout', function() {
            err('timeout');
        });
        conn.on('error', function(e) {
            err(e.message);
        });
    };
};

var watchChild = function(child, args) {
    return function(ack, err) {
        var chld = child_process.spawn(child, args);
        chld.on('error', function(e) {
            err(e.message);
        });
        chld.on('exit', function(code, signal) {
            if (signal !== null) {
                err(signal);
            } else if (code != 0) {
                err('Exited with code ' + code);
            } else {
                ack();
            }
        });
    };
};

var watchPing = function(target) {
    return watchChild('ping', ['-c', '1', '-W', '3', target]);
};

var context = vm.createContext({
    'addWatcher': function(name, watcher) {
        watchers[name] = watcher;
    },
    'watchHTTP': watchHTTP,
    'watchChild': watchChild,
    'watchTCP': watchTCP,
    'watchPing': watchPing,
    'require': require
});
opt.argv.forEach(function(sfile) {
    var services = fs.readFileSync(sfile);

    vm.runInContext(services, context, sfile);
});
console.log(watchers);

var services = [];
for (var watcher in watchers) {
    if (watchers.hasOwnProperty(watcher)) {
        services.push(watcher);
    }
}
var statuses = {};
services.forEach(function(service) {
    statuses[service] = '...';
});
var statBus = new Bacon.Bus();
var Stat = statBus.toProperty(statuses);

var setStatus = function(service, stat) {
    var oldStatus = statuses[service];
    if (oldStatus === stat) {
        return;
    }
    statuses[service] = stat;
    statBus.push(statuses);
};

var propertiesInflight = [];
var currentQueryGeneration = 0;

var runQueries = function() {
    currentQueryGeneration += 1;
    var currentQuery = currentQueryGeneration;
    propertiesInflight.forEach(function(inflight) {
        setStatus(inflight, 'query timed out');
    });
    services.forEach(function(service) {
        propertiesInflight.push(service);
        var watcher = watchers[service];
        var recv = function(stat) {
            if (currentQuery !== currentQueryGeneration)
                return;
            var ix = propertiesInflight.indexOf(service);
            if (ix > -1) {
                propertiesInflight.splice(ix, 1);
                setStatus(service, stat);
            }
        };
        var ack = function() {
            recv(null);
        };
        var err = function(e) {
            recv(e || 'error');
        };
        setImmediate(function() {
            watcher(ack, err);
        });
    });
};

runQueries();

var INTERVAL = 6;
setInterval(runQueries, INTERVAL*1000);

Stat.onValue(function(val) {
    console.log(val);
});

var express = require('express');
var app = express();
var root = fs.readFileSync(__dirname + '/index.html', {'encoding': 'utf-8'});
root = root.replace('$ROOT$', '');

app.get('/', function(req, res) {
    res.header('Content-Type', 'text/html; charset=utf-8');
    res.end(root);
});

app.get('/status', function(req, res) {
    res.header('Content-Type', 'application/json');
    res.end(JSON.stringify(statuses));
});

var sse = new SSE([]);

app.get('/stream', sse.init);

Stat.onValue(function(x) {
    sse.send(x);
    sse.updateInit([x]);
});

app.use('/static', express.static(__dirname + '/static'));

var server = app.listen(port, '::', function() {
    var ad = server.address();
    var hs = ad.address;
    var pt = ad.port;
    console.log("Listening on http://%s:%s", hs, pt);
});

