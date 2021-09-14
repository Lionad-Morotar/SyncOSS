/**
 * Tasker
 * 任务队列管理以及任务并发控制
 */
module.exports = class Tasker {
  constructor(conf) {
    this.results = []
    this.todos = []
    this.doing = []
    this.totalTask = 0
    this.interval = conf.interval || 0
    this.maxConcurrenceCount = conf.maxConcurrenceCount || 1
    this.running = false
    this.resolver = null
    return this
  }

  async start(tasks) {
    this.addTask(tasks)
    const curTaskRunner = new Promise(async (resolve) => {
      this.resolver = resolve
    })
    return curTaskRunner
  }

  /* 任务相关 */
  addTask(task) {
    const tasks = Array.isArray(task) ? task : [task]
    this.totalTask += tasks.length
    this.todos.push(...tasks)
    if (!this.running) {
      this.execute()
    }
    return this
  }
  recordTask(task) {
    this.doing.push(task)
  }
  removeTask(task) {
    this.doing.splice(
      this.doing.findIndex((x) => x === task),
      1
    )
  }
  pushResult(res) {
    this.results.push(res)
    if (this.results.length === this.totalTask) {
      this.running = false
      this.resolver && this.resolver(this.results)
    }
  }

  /**
   * 计算并发富余量
   */
  calcRestConcurrenceCount() {
    const restCons = this.maxConcurrenceCount - this.doing.length
    const result = Math.min(restCons <= 0 ? 0 : restCons, this.todos.length)
    return result
  }

  /**
   * 开始执行任务
   */
  async execute() {
    this.running = true
    const restConCount = this.calcRestConcurrenceCount()

    // 任务间隙休息片刻
    const rest = async () => {
      const interval = this.interval instanceof Function ? this.interval(task) : this.interval
      await new Promise((resolve) => setTimeout(resolve, interval))
    }

    if (restConCount) {
      Array(restConCount)
        .fill('')
        .map(async (_) => {
          const task = this.todos.shift()
          if (!task) {
            throw new Error('[ERR] 任务不存在')
          }

          // FIXME
          const artifactMaybe = this.results[this.results.length - 1]
          this.recordTask(task)

          let res
          try {
            res = await this.run(task, artifactMaybe)
          } catch (err) {
            throw err
          } finally {
            this.removeTask(task)
          }

          await rest()
          this.pushResult(res)
          this.execute()
        })
    } else {
      await rest()
      this.execute()
    }
  }

  /**
   * 执行任务
   * @param {object} task 任务配置
   * @param {any|null} artifactMaybe 上一个任务执行完返回的产物
   */
  async run(task, artifactMaybe) {
    const { id, run } = task
    return await run.bind(this)({
      artifact: artifactMaybe,
    })
  }
}
