var dns = require('dns');

addWatcher('Internet uplink', watchPing('8.8.8.8'));
addWatcher('Internet uplink (v6)', watchPing6('2001:4860:4860::8888'));
addWatcher('DNS', function(ack, err) {
    dns.resolve('google.com', function(e, addresses) {
        if (e) {
            err(e.message);
        } else {
            if (addresses.length == 0) {
                err("no records");
            } else {
                ack();
            }
        }
    });
});
/**
 * Check a non-existent name to ward off captive portals.
 */
addWatcher('Negative DNS', function(ack, err) {
    dns.resolve('nonexistant.example.com', function(e, addresses) {
        if (e) {
            if (
                e.code == 'ENOTFOUND' ||
                e.code == 'ETIMEOUT' ||
                e.errno == 'ENOTFOUND' ||
                e.errno == 'ETIMEOUT'
            ) {
                ack();
            } else {
                err(e.message);
            }
        } else {
            if (addresses.length > 0) {
                err("false address generated: " + addresses[0]);
            } else {
                err("false positive (empty) record");
            }
        }
    });
});
