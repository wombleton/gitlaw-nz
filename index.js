var async = require('async'),
    cheerio = require('cheerio'),
    _ = require('underscore'),
    fs = require('fs'),
    path = require('path'),
    request = require('request'),
    url = require('url'),
    md = require('html-md'),
    GitHubApi = require("github"),
    github,
    actQueue,
    searchQueue,
    retried = {};

github = new GitHubApi({
    // required
    version: "3.0.0",
    // optional
    timeout: 5000
});

_.each('ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split(''), function(letter) {
    try {
        fs.mkdirSync('acts/' + letter);
    } catch(e) {}
});

function scrapeSearch(uri, callback) {
    request({
        uri: uri
    }, function(err, response, body) {
        var $,
            href,
            acts;

        if (err) {
            console.log(err);
            process.exit(1);
        } else {
            $ = cheerio.load(body);
            href = $('.search-results-pagination li:last-child a').attr('href');

            if (href) {
                href = 'http://www.legislation.govt.nz' + href;
                console.log('Loading: ' + href);
                searchQueue.push(href);
            }

            acts = $('.resultsTitle a');

            _.each(acts, function(act) {
                var file,
                    title,
                    uri;

                act = $(act);

                title = act.text();
                uri = url.parse(act.attr('href'));

                uri.search = undefined;
                uri.pathname = uri.pathname.replace(/\/[^\/]+\.html$/, '/whole.html');

                actQueue.unshift({
                    title: title,
                    uri: 'http://www.legislation.govt.nz' + url.format(uri)
                });
            });

            callback();
        }
    });
}

function getPath(title) {
    title = title.trim().replace(/\r\n?/g, ' ').replace(/\//g, '-');

    return path.join('acts', title.substring(0, 1).toUpperCase(), title) + '.md';
}

function downloadAct(task, callback) {
    var uri = task.uri;

    // skip former title acts
    if (/formertitle\.aspx/.test(uri)) {
        return callback();
    }

    console.log("Requesting " + uri + " with " + actQueue.length() + " items still in the queue.");
    request({
        timeout: 15000,
        uri: uri
    }, function(err, response, body) {
        var $,
            act,
            title,
            file,
            path,
            markdown,
            dir;

        if (err || Math.floor(response.statusCode / 100) !== 2) {
            console.error("Couldn't download " + uri + ' because ' + err);
            callback();
            if (!retried[uri]) {
                retried[uri] = true;
                actQueue.push(uri);
            }
        } else {
            $ = cheerio.load(body);

            act = $('.act').html();
            title = $('h1.title').first().text();

            markdown = makeMarkdown(act, uri);

            if (title) {
                path = getPath(title);
                auth();
                github.repos.getContent({
                    user: process.env.USER,
                    repo: process.env.REPO,
                    path: path
                }, function(err, data) {
                    if (err) {
                        callback(err);
                    } else {
                        if (new Buffer(data.content, 'base64').toString('utf8') !== markdown) {
                            updateAct(path, title, data, markdown, callback);
                        } else {
                            console.log("%s matches. Moving to next file.", path);
                            callback();
                        }
                    }
                });
            }
        }
    });
}

function auth() {
    github.authenticate({
        type: 'oauth',
        token: process.env.GITHUB_TOKEN
    });
}

function respectLimit(obj, callback) {
    if (obj && obj.meta && obj.meta['x-ratelimit-remaining'] === '0') {
        setTimeout(callback, 60 * 60 * 1000);
    } else {
        callback();
    }
}

function updateAct(path, title, data, markdown, callback) {
    auth();
    console.log("Updating %s to new content", path);
    debugger;
    GitHubApi.prototype.httpSend.call(github, {
        user: process.env.USER,
        repo: process.env.REPO,
        path: path,
        message: "New version for " + title,
        content: new Buffer(markdown).toString('base64'),
        sha: data.sha,
        author: {
            name: "GitLaw NZ Bot",
            email: USER_EMAIL
        }
    }, {
        method: 'PUT',
        url: "/repos/:user/:repo/contents/:path",
        params: {
            "$user": null,
            "$repo": null,
            "$path": null,
            "message": null,
            "content": null,
            "sha": null,
            "author": null
        }
    },
    function(err, result) {
        if (err) {
            console.log("Error updating: %s", err);
        } else {
            console.log("Successfully updated %s", path);
        }
        callback(err);
    });
}

function makeMarkdown(act, uri) {
    var markdown = md(act);

    return markdown.replace(/(\n\[\d+\]: )([^\n]+)/g, function(match, number, pathname) {
        return number + url.resolve(uri, pathname);
    });
}

searchQueue = async.queue(scrapeSearch);

actQueue = async.queue(downloadAct, 1);

actQueue.on('drain', function() {
    setTimeout(function() {
        searchQueue.push('http://www.legislation.govt.nz/act/results.aspx?search=ta_act_All_ac%40ainf%40anif_an%40bn%40rn_200_a&p=1');
    }, 24 * 60 * 60 * 1000);
    console.log("Restarting scan in 24 hours.");
});

searchQueue.push('http://www.legislation.govt.nz/act/results.aspx?search=ta_act_All_ac%40ainf%40anif_an%40bn%40rn_200_a&p=1');
