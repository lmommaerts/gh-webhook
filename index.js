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

function getArrayValues(str, label, delimiter, start, end) {
	var stringStart = str.indexOf(label);
	var arrayStart = str.indexOf(start, stringStart);
	var arrayEnd = str.indexOf(end, arrayStart);
	var array = [];

	if (arrayStart < arrayEnd) {
		var arrayString = str.substring(arrayStart + 1, arrayEnd);
		array = arrayString.split(delimiter).map(function(item) { return item.trim(); }).filter(function(item) { return !!item; });
	}

	return array;
}

function labelIssue(repo, issue) {
	var body = issue.body;
	var labelArray = getArrayValues(body, '**Labels**:', ',', '[', ']');

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

function addIssueToProject(repo, issue, projectNames) {
	var projectColumnName = 'Backlog';

	var newProjects = [];
	var existingProjects = [];
	var projectNamesUsed = [];

	github.projects.getRepoProjects({
		owner: repo.owner.login,
		repo: repo.name,
	}, function(err, allProjects) {
		allProjects.forEach(function(project) {
			if (projectNames.indexOf(project.name) >= 0) {
				existingProjects.push(project);
				projectNamesUsed.push(project.name);
			}
		});

		projectNames.forEach(function(projectName) {
			if (projectNamesUsed.indexOf(projectName) < 0) {
				newProjects.push(projectName);
			}
		});

		existingProjects.forEach(function(project) {
			github.projects.getProjectColumns({
				project_id: project.id,
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
						project_id: project.id,
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
		});

		newProjects.forEach(function(projectName) {
			github.project.createRepoProject({
				owner: repo.owner.login,
				repo: repo.name,
				name: projectName,
				body: '',
			}, function(err, newProject) {
				github.projects.createProjectColumn({
					project_id: newProject.id,
					name: projectColumnName,
				}, function(err, newColumn) {
					github.projects.createProjectCard({
						column_id: newColumn.id,
						content_id: issue.id,
						content_type: 'Issue',
					});
				});
			});
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

	if (['opened', 'edited'].indexOf(data.action) >= 0) {
		var body = issue.body;
		var projectArray = getArrayValues(body, '**Projects**:', ',', '[', ']');
		if (data.action === 'edited') {
			var prevProjectArray = getArrayValues(issue.changes.body.from, '**Projects**:', ',', '[', ']');
			projectArray = _.difference(projectArray, prevProjectArray);
		}
		addIssueToProject(repository, issue, projectArray);
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
