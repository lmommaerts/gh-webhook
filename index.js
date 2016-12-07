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

var repos = (process.env.GITHUB_REPOS || '').split(',');

function labelIssue(repo, issue) {
	var body = issue.body;
	var labelStringStart = body.indexOf('**Labels**:');
	var labelArrayStart = body.indexOf('[', labelStringStart);
	var labelArrayEnd = body.indexOf(']', labelArrayStart);
	var labelArray = [];

	if (labelArrayStart < labelArrayEnd) {
		var labelArrayString = body.substring(labelArrayStart + 1, labelArrayEnd);
		labelArray = labelArrayString.split(',').map(function(label) { return label.trim(); }).filter(function(label) { return !!label; });
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
		owner: repo.owner.login,
		repo: repo.name,
		number: issue.number,
		body: newLabels,
	});
	removeLabels.forEach(function(label) {
		github.issues.removeLabel({
			owner: repo.owner.login,
			repo: repo.name,
			number: issue.number,
			name: label,
		});
	});
}

function addIssueToProject(repo, data) {
	var issue = data.issue;
	var repository = data.repository;
	var body = issue.body;
	var projectStringStart = body.indexOf('**Projects**:');
	var projectArrayStart = body.indexOf('[', projectStringStart);
	var projectArrayEnd = body.indexOf(']', projectArrayStart);
	var projectArray = [];
	var projectColumnName = 'Backlog';

	if (projectArrayStart < projectArrayEnd) {
		var projectArrayString = body.substring(projectArrayStart + 1, projectArrayEnd);
		projectArray = projectArrayString.split(',').map(function(label) { return label.trim(); }).filter(function(label) { return !!label; });
	}

	var existingProjects = github.projects.getRepoProjects({
		owner: repository.owner.login,
		repo,
	}, function(err, existingProjects) {
		existingProjects.forEach(function(existingProject) {
			if (projectArray.indexOf(existingProject.name) < 0) {
				github.projects.getProjectColumns({
					project_id: existingProject.id,
				}, function(err, columns) {
					var columnExists = false;
					columns.forEach(function(column) {
						if (column.name === projectColumnName) {
							columnExists = true;
							github.projects.createProjectCard({
								column_id: column.id,
								content_id: issue.id,
								content_type: 'Issue',
							});
						}
					});

					if (!columnExists) {
						// create column
						github.projects.createProjectColumn({
							project_id: existingProject.id,
							name: projectColumnName,
						}, function(err, newColumn) {
							github.projects.createProjectCard({
								column_id: newColumn.id,
								content_id: issue.id,
								content_type: 'Issue',
							});
						});
					}
				});
			}
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
	});
}

webhookHandler.on('pull_request', function (repo, data) {
	if (repos.indexOf(repo) < 0 || data.action === 'labeled') {
		return;
	}

	var repository = data.repository;
	var pr = data.pull_request;

	if (data.action !== 'labeled') {
		labelIssue(repository, pr);
	}
});
webhookHandler.on('issues', function (repo, data) {
	if (repos.indexOf(repo) < 0) {
		return;
	}

	var repository = data.repository;
	var issue = data.issue;

	if (data.action === 'created') {
		addIssueToProject(repository, issue);
	}

	if (data.action !== 'labeled') {
		labelIssue(repository, issue);
	}
});

webhookHandler.on('error', function (err, req, res) {
	console.error('an error occurred', err);
})

app.listen(app.get('port'), function () {
	console.log('listening on port ' + app.get('port'));
});
