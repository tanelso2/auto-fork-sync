module.exports = (robot) => {
  // Your code here
  robot.log('Yay, the app was loaded!')
  robot.log(robot)

  robot.on('push', async context => {
    robot.log(context)
    const github = context.github
    const payload = context.payload
    const forks = await getListOfForks(payload.repository, github)
    const branchName = payload.ref.substring(11) // Gets rid of the refs/head part
    const parentRepo = getRepoDict(payload.repository)
    for (const fork of forks) {
      await updateChildBranch(robot, branchName, parentRepo, fork)
    }
  })
}

function getRepoDict (repository) {
  return {
    owner: repository.owner.login,
    repo: repository.name
  }
}

async function getListOfForks (repository, github) {
  const {owner, repo} = getRepoDict(repository)
  const result = await github.repos.getForks({owner, repo})
  const forks = result.data.map(getRepoDict)
  return forks
}

async function updateChildBranch (robot, branchName, parentRepo, childRepo) {
  const appClient = await robot.auth()
  const github = await getClientForRepo(robot, appClient, childRepo)
  const payload = {
    title: `[Auto Fork Sync] Updating branch ${branchName}`,
    owner: childRepo.owner,
    repo: childRepo.repo,
    head: `${parentRepo.owner}:${branchName}`,
    base: branchName,
    body: 'Auto Fork Sync engaged',
    maintainer_can_modify: false
  }
  robot.log(`Trying to create a pullRequest on child ${childRepo.owner}:${childRepo.repo}`)
  const result = await github.pullRequests.create(payload)
  const pullRequestId = result.data.number
  console.log(`Attempting to merge pull request ${pullRequestId} on ${childRepo.owner}/${childRepo.repo}`)
  const mergeResult = await github.pullRequests.merge({
    owner: childRepo.owner,
    repo: childRepo.repo,
    number: pullRequestId,
    merge_method: 'rebase'
  })
  console.log(mergeResult)
  if (mergeResult.data.merged) {
    console.log('Hooray! The merge worked!')
  }
}

async function getClientForRepo (robot, appClient, {owner}) {
  // TODO: Paginate
  // TODO: Cache
  const installations = await appClient.apps.getInstallations({})
  robot.log('INSTALLATIONS')
  robot.log(installations)
  for (const installation of installations.data) {
    if (installation.account.login === owner) {
      return robot.auth(installation.id)
    }
  }
  return undefined // Should figure out how error handling works.
}
