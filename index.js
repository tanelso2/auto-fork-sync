module.exports = (robot) => {
  const handler = new AutoForkSyncRobotHandler(robot)
  robot.log('Yay, the app was loaded!')
  robot.log(robot)
  robot.on('create', async (context) => handler.handleCreate(context))
  robot.on('push', async (context) => handler.handlePush(context))
}

class AutoForkSyncRobotHandler {
  constructor (robot) {
    this.robot = robot
  }

  async handleCreate (context) {
    this.robot.log(context)
    const config = await context.config('auto-fork-sync.yaml', {branch_blacklist: [], merge_strategy: 'rebase'})
    const github = context.github
    const payload = context.payload
    const forks = await this.getListOfForks(payload.repository, github)
    const branchName = payload.ref.substring(11) // Gets rid of the refs/head/ part
    if (config.branch_blacklist.includes(branchName)) {
      return
    }
    const parentRepo = getRepoDict(payload.repository)
    for (const fork of forks) {
      await this.createChildBranch(branchName, parentRepo, fork)
    }
  }

  async handlePush (context) {
    this.robot.log(context)
    const config = await context.config('auto-fork-sync.yaml', {branch_blacklist: [], merge_strategy: 'rebase'})
    const github = context.github
    const payload = context.payload
    const forks = await this.getListOfForks(payload.repository, github)
    const branchName = payload.ref.substring(11) // Gets rid of the refs/head/ part
    const parentHash = payload.head_commit.id
    if (config.branch_blacklist.includes(branchName)) {
      return
    }
    const parentRepo = getRepoDict(payload.repository)
    for (const fork of forks) {
      await this.updateChildBranch(branchName, parentHash, parentRepo, fork)
    }
  }

  async createChildBranch (branchName, parentRepo, childRepo) {
    const github = await this.getClientForRepo(childRepo)
    // TODO: Create PR from parent to existing branch on child
    // Create ref with the head sha from that PR
  }

  async updateChildBranch (branchName, parentSha, parentRepo, childRepo) {
    // Instead of creating pull requests and merging them, could we create pull requests and then
    // set the branch to the ref in the PR? Does the sha even exist in the repo at that point?
    // Answer: yes it does. Sweet
    const github = await this.getClientForRepo(childRepo)
    const pullRequestId = await this.createPullRequest(github, parentRepo, childRepo, branchName)
    await this.setBranchToRef(github, childRepo, parentSha, branchName)
    // await this.mergePullRequest(pullRequestId, childRepo, github)
  }

  async mergePullRequest (pullRequestId, childRepo, github) {
    this.robot.log(`Attempting to merge pull request ${pullRequestId} on ${getRepoString(childRepo)}`)
    const mergeResult = await github.pullRequests.merge({
      owner: childRepo.owner,
      repo: childRepo.repo,
      number: pullRequestId,
      merge_method: 'merge'
    })
    this.robot.log(mergeResult)
    if (mergeResult.data.merged) {
      this.robot.log('Hooray! The merge worked!')
    }
  }

  async setBranchToRef (github, repo, sha, branchName) {
    this.robot.log(`Attempting to set branch ${branchName} on ${getRepoString(repo)} to sha ${sha}`)
    const force = false // This should just fail so that we don't accidentally overwrite work
    const payload = {
      owner: repo.owner,
      repo: repo.repo,
      ref: `heads/${branchName}`,
      sha: sha,
      force: force
    }
    const result = await github.gitdata.updateReference(payload)
    this.robot.log(result)
  }

  async createPullRequest (github, parentRepo, childRepo, branchName) {
    const payload = {
      title: `[Auto Fork Sync] Updating branch ${branchName}`,
      owner: childRepo.owner,
      repo: childRepo.repo,
      head: `${parentRepo.owner}:${branchName}`,
      base: branchName,
      body: 'Auto Fork Sync engaged',
      maintainer_can_modify: false // See: https://github.com/octokit/rest.js/pull/491
    }
    try {
      this.robot.log(`Trying to create a pullRequest on child ${getRepoString(childRepo)}`)
      const result = await github.pullRequests.create(payload)
      return result.data.number
    } catch (err) {
      this.robot.log('Caught error')
      this.robot.log(err)
      const errors = JSON.parse(err.message).errors
      this.robot.log(errors)
      for (const error of errors) {
        if (error.resource === 'PullRequest' && error.field === 'base' && error.code === 'invalid') {
          this.robot.log(`The branch does not exist on ${getRepoString(childRepo)}`)
          // TODO: Try creating it!
        }
      }
      return undefined
    }
  }

  async getClientForRepo ({owner}) {
    const appClient = await this.robot.auth()
    // TODO: Paginate
    // TODO: Cache
    const installations = await appClient.apps.getInstallations({})
    this.robot.log('INSTALLATIONS')
    this.robot.log(installations)
    for (const installation of installations.data) {
      if (installation.account.login === owner) {
        return this.robot.auth(installation.id)
      }
    }
    return undefined // Should figure out how error handling works.
  }

  async getListOfForks (repository, github) {
    const {owner, repo} = getRepoDict(repository)
    const result = await github.repos.getForks({owner, repo})
    return result.data.map(getRepoDict)
  }
}

function getRepoDict (repository) {
  return {
    owner: repository.owner.login,
    repo: repository.name
  }
}

function getRepoString (repo) {
  return `${repo.owner}/${repo.repo}`
}
