'use strict';

const async = require('async'),
  cheerio = require('cheerio'),
  _ = require('lodash'),
  path = require('path'),
  request = require('request'),
  url = require('url'),
  md = require('html-md'),
  GitHub = require('github-api'),
  shagit = require('shagit'),
  SEARCH_URL = 'http://www.legislation.govt.nz/act/results.aspx?search=ta_act_All_ac%40ainf%40anif_an%40bn%40rn_200_a&p=1',
  retried = {};

const searchQueue = async.queue(scrapeSearch);
searchQueue.push(SEARCH_URL);

const actQueue = async.queue(downloadAct, process.env.QUEUE_SIZE || 1);

const github = new GitHub({
  token: process.env.GITHUB_TOKEN,
  auth: 'oauth'
});
const repo = github.getRepo(process.env.USER, process.env.REPO);

function scrapeSearch(uri, callback) {
  console.log(`Loading: ${uri}`);
  request({
    uri: uri
  }, function(err, response, body) {
    if (err) {
      console.log(err);
      process.exit(1);
    } else {
      const $ = cheerio.load(body);

      const acts = $('.resultsTitle a');

      _.each(acts, function(act) {
        act = $(act);

        const title = act.text();

        uri = url.parse(act.attr('href'));

        uri.search = undefined;
        uri.pathname = uri.pathname.replace(/\/[^\/]+\.html$/, '/whole.html');

        actQueue.push({
          title: title,
          uri: 'http://www.legislation.govt.nz' + url.format(uri)
        });
      });

      let href = $('.search-results-pagination li:last-child a').attr('href');

      if (href) {
        href = 'http://www.legislation.govt.nz' + href;
        actQueue.push({
          search: true,
          uri: href
        });
      } else {
        setTimeout(function() {
          searchQueue.push(SEARCH_URL);
        }, 24 * 60 * 60 * 1000);
        console.log('Restarting scan in 24 hours.');
      }

      callback();
    }
  });
}

function getPath(title) {
  title = title.trim().replace(/\r\n?/g, ' ').replace(/\//g, '-');

  return path.join('acts', title.substring(0, 1).toUpperCase(), title) + '.md';
}


function handleAct(options, callback) {
  const { response, body, uri } = options;

  if (Math.floor(response.statusCode / 100) !== 2) {
    callback();
    if (!retried[uri]) {
      retried[uri] = true;
      actQueue.push(uri);
    }
  } else {
    const $ = cheerio.load(body);

    const title = $('h1.title').first().text();

    const act = $('.act').html();
    const markdown = makeMarkdown(act, uri);

    if (title) {
      const file = getPath(title);
      repo.getSha('master', file, function(err, contentSha) {
        if (err) {
          if (err === 'not found') {
            updateAct(file, title, markdown, callback);
          } else {
            console.log('Error checking github: %s. Sleeping for an hour...', err);
            setTimeout(function() {
              callback(err);
            }, 60 * 60 * 1000);
          }
        } else {
          const sha = shagit(markdown);

          if (sha !== contentSha) {
            updateAct(file, title, markdown, callback);
          } else {
            console.log('%s matches. Moving to next file.', file);
            callback();
          }
        }
      });
    }
  }
}

function downloadAct(task, callback) {
  var uri = task.uri;

  // skip former title acts
  if (/formertitle\.aspx/.test(uri)) {
    return callback();
  } else if (task.search) {
    searchQueue.push(uri);
    return callback();
  }

  console.log('Requesting %s with %d items still in the queue and %d workers.', uri, actQueue.length(), actQueue.concurrency);
  request({
    uri: uri
  }, function(err, response, body) {
    if (err) {
      console.error(`Couldnt download ${uri} because ${err}`);
      return callback(err);
    }
    handleAct({
      body: body,
      response: response,
      uri: uri
    }, callback);
  });
}

function updateAct(file, title, markdown, callback) {
  console.log('Updating %s to new content', file);
  repo.write('master', file, markdown, `New version for ${title}`, function(err) {
    if (err) {
      console.log('Error updating: %s', err);
    } else {
      console.log('Successfully updated %s', file);
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

