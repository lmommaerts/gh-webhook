var express = require('express');
var _ = require('lodash');
var request = require('request');
var GitHubApi = require('github');
var GithubWebHook = require('express-github-webhook');
var bodyParser = require('body-parser');
var debug = require('debug-log')('github-auto-label');

var accessToken = process.env.GITHUB_TOKEN;

if (!accessToken) {
	console.log('no token');
	return;
}

var github = new GitHubApi({
    // optional
    // debug: true,
    protocol: "https",
    host: "api.github.com", // should be api.github.com for GitHub
    headers: {
        "user-agent": "gh-webhook" // GitHub is happy with a unique user agent
    },
    followRedirects: false, // default: true; there's currently an issue with non-get redirects, so allow ability to disable follow-redirects
    timeout: 5000
});

github.authenticate({
    type: "oauth",
    token: accessToken,
});

var repos = github.repos.getAll({}, function(err, res) {
	res.forEach(function(repo) {
	});
});


var webhookSettings = {
	path: process.env.WEBHOOK_PATH || '/',
	secret: process.env.GITHUB_SECRET,
};

var webhookHandler = GithubWebHook(webhookSettings);

var app = express();
app.set('port', process.env.PORT || 5555);
app.use(bodyParser.json());
app.use(webhookHandler);

webhookHandler.on('pull_request', function (repo, data) {
	if (repos.indexOf(repo) < 0 || data.action !== 'opened' || labels.pr.length === 0) {
		return;
	}
	debug(
		'[%s] Incoming webhook. adding labels %s to %s#%s',
		JSON.stringify(labels.pr), repo, data.pull_request.number
	);
	var opts = {
		method:'POST',
		uri: data.pull_request.issue_url + '/labels',
		headers: {
			'User-Agent': 'gh-webhook',
			'Authorization': 'token '+accessToken,
			'Content-Type': 'application/json'
		},
		form: JSON.stringify(labels.pr)
	};
	request(opts, function(err, results, body) {
		if (err) {
			console.error(err);
		}
		debug(
			'[%s] API response %s',
			JSON.stringify(body, null, ' ')
		);
	});
});
webhookHandler.on('issues', function (repo, data) {
	if (repos.indexOf(repo) < 0 || data.action !== 'opened' || labels.issue.length === 0) {
		return;
	}
	debug(
		'[%s] Incoming webhook. adding labels %s to %s#%s',
		JSON.stringify(labels.issue),
		repo,
		data.issue.number
	);
	var opts = {
		method:'POST',
		uri: data.issue.url + '/labels',
		headers: {
			'User-Agent': 'gh-webhook',
			'Authorization': 'token '+accessToken,
			'Content-Type': 'application/json'
		},
		form: JSON.stringify(labels.issue)
	};
	request(opts, function(err, results, body){
		if (err) {
			console.error(err);
		}
		debug(
			'[%s] API response %s',
			JSON.stringify(body, null, ' ')
		);
	});
});

webhookHandler.on('error', function (err, req, res) {
	console.error('an error occurred', err);
})

app.listen(app.get('port'), function () {
	console.log('listening on port ' + app.get('port'));
});
