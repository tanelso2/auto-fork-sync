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
    if (config.branch_blacklist.includes(branchName)) {
      return
    }
    const parentRepo = getRepoDict(payload.repository)
    for (const fork of forks) {
      await this.updateChildBranch(branchName, parentRepo, fork)
    }
  }

  async createChildBranch (branchName, parentRepo, childRepo) {
    const github = await this.getClientForRepo(childRepo)
    // Shoot, we have to use the github api to create a ref.
    // But we need to figure out what sha to set the ref to
    // It has to be one that already exists on the child repo,
    // but also one that merges correctly with the parent branch
    // This could be challenging
  }

  async updateChildBranch (branchName, parentRepo, childRepo) {
    const github = await this.getClientForRepo(childRepo)
    const pullRequestId = await this.createPullRequest(github, parentRepo, childRepo, branchName)
    this.robot.log(`Attempting to merge pull request ${pullRequestId} on ${getRepoString(childRepo)}`)
    const mergeResult = await github.pullRequests.merge({
      owner: childRepo.owner,
      repo: childRepo.repo,
      number: pullRequestId,
      merge_method: 'rebase'
    })
    this.robot.log(mergeResult)
    if (mergeResult.data.merged) {
      this.robot.log('Hooray! The merge worked!')
    }
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
