var express = require('express');
var _ = require('lodash');
var GitHubApi = require('github');
var GithubWebHook = require('express-github-webhook');
var bodyParser = require('body-parser');

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
});
webhookHandler.on('issues', function (repo, data) {
	if (data.action === 'labeled') {
		return;
	}
	var issue = data.issue;
	var repository = data.repository;
	var body = issue.body;
	var labelStringStart = body.indexOf('**Labels**:');
	var labelArrayStart = body.indexOf('[', labelStringStart);
	var labelArrayEnd = body.indexOf(']', labelArrayStart);
	var labelArray = [];

	if (labelArrayStart < labelArrayEnd) {
		var labelArrayString = body.substring(labelArrayStart + 1, labelArrayEnd);
		labelArray = labelArrayString.split(',').map(function(label) { return label.trim(); });
	}

	var existingLabels = issue.labels.map(function(existingLabel) {
		return existingLabel.name;
	});
	var newLabels = [];
	var removeLabels = [];
	existingLabels.forEach(function (existingLabel) {
		if (labelArray.indexOf(existingLabel) < 0) {
			removeLabels.push(existingLabel);
		}
	});

	labelArray.forEach(function(label) {
		if (existingLabels.indexOf(label) < 0) {
			newLabels.push(label);
		}
	});

	github.issues.addLabels({
		owner: repository.owner.login,
		repo: repo,
		number: issue.number,
		body: newLabels,
	});
	removeLabels.forEach(function(label) {
		github.issues.removeLabel({
			owner: repository.owner.login,
			repo: repo,
			number: issue.number,
			name: label,
		});
	});
});

webhookHandler.on('error', function (err, req, res) {
	console.error('an error occurred', err);
})

app.listen(app.get('port'), function () {
	console.log('listening on port ' + app.get('port'));
});
