class ExitSignal {
  constructor(code) {
    this.code = code
    this.__exit = true
  }
}

//⁠​‌‌‌​​‌‌‍​‌‌​‌​​‌‍​‌‌​​‌‌‌‍​​‌​‌‌‌‌‍​​‌‌​​​‌‍​‌‌‌‌‌​​‍​​‌‌‌​​‌‍​​‌‌‌​​​‍​​‌‌​‌​‌‍​‌‌​​‌​​‍​​‌‌​‌‌​‍​‌‌​​‌‌​‍​‌‌​​‌​​‍​‌‌​​‌​‌‍​​‌‌​‌​‌‍​​‌‌‌​​‌‍​‌‌​​​‌​‍​​‌‌​‌‌​‍​​‌‌​‌​‌‍​​‌‌‌​​​‍​​‌‌‌​​​‍​​‌‌​​‌‌‍⁣
export function installExitShim() {
  process.exit = (code = 0) => {
    throw new ExitSignal(code)
  }
  const handle = (e) => {
    if (e && e.__exit) {
      process.exitCode = e.code
      return
    }
    console.error(e?.stack ?? e)
    process.exitCode = 1
  }
  process.on('uncaughtException', handle)
  process.on('unhandledRejection', handle)
}
