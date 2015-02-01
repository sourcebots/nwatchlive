var count = 0;

addWatcher('pony', function(ack, err) {
    count += 1;
    if (count % 4 == 2) {
        err('out for the count');
    } else {
        ack();
    }
});

addWatcher('py', watchHTTP('http://localhost:8080/irc_handlers.py'));

addWatcher('Google DNS', watchPing('8.8.8.8'));

