function Task(taskFn, awaitFn) {
	if (typeof taskFn !== 'function')
		throw new TypeError("Invalid type of parameter 'taskFn'!");
	this.thisTaskFn_ = taskFn;
	this.taskArgs_ = Array.prototype.slice.call(arguments, 2, arguments.length);
	this.nextTask_ = null;
	this.awaiting_ = (typeof awaitFn == 'function') ? awaitFn : null;
	
	this.context_ = {};
	this.throuthContext_ = false;
	this.taskResult_ = {};

	this.state_ = null;
	this.timeout_ = null;
	this.timeoutObject_ = null;

	this.throuthTimeout_ = false;
}
Task.prototype = {
	get Result() { 
		return this.taskResult_;
	},
	set Result(val) {
		this.taskResult_ = val;
	},
	get NextTask() {
		return this.nextTask_;
	},
	SetTimeout : function (val) {
		if (val == null || val === undefined)
			this.timeout_ = 0;
		else
			this.timeout_ = val;
		return this;
	},
	get ThrouthTimeout(){ 
		return this.throuthTimeout_;
	},
	set ThrouthTimeout(val) {
		if (typeof val != 'boolean') throw new TypeError('Setter of \'ThrouthTimeout\': setting value is not a Boolean type');
		this.throuthTimeout_ = val;
	},
	get State(){
		return this.state_;
	},
	get ThrouthContext() {
		return this.throuthContext_;
	},
	set ThrouthContext(val) {
		if (typeof val != 'boolean') throw new TypeError('Setter of \'ThrouthContext\': setting value is not a Boolean type');
		this.throuthContext_ = val;
	},
	get Context() {
		return this.context_;
	},
	set Context(val) {
		this.context_ = val;
	},
	get Args() {
		return this.taskArgs_;
	}
}
Task.prototype.Next = function (error) {
	if (this.state_ !== Task.TaskState.TimeIsOut && this.state_ !== Task.TaskState.Faulted && this.state_ !== Task.TaskState.Failed) {
		this.state_ = Task.TaskState.Completed;
	}
	if (this.timeoutObject_ != null && this.timeoutObject_ !== undefined)
		clearTimeout(this.timeoutObject_);
	this.thisTaskFn_ = undefined;
	this.taskArgs_.splice(0, this.taskArgs_.length);

	var lArgs = Array.prototype.slice.call(arguments, 1, arguments.length);
		
	if (error != null && error !== undefined) {
		if (this.awaiting_ !== undefined && this.awaiting_ != null) {
			this.awaiting_.call(null, error, this.Context);
			//this.awaiting_ = null;
			//this.nextTask_ = null;
		}
	}
	else if (this.state_ === Task.TaskState.TimeIsOut) {
		var lError = new TaskTimeoutError("Timeout expired!", this.timeout_); 
		if (this.awaiting_ !== undefined && this.awaiting_ != null) {
			this.awaiting_.call(null, lError, this.Context);
			//this.awaiting_ = null;
			//this.nextTask_ = null;
		}
	}
	else  {
		if (this.nextTask_ == null || this.nextTask_ === undefined) {
			this.awaiting_.apply(null, [null, this.Context].concat(lArgs));
			//this.awaiting_ = null;
		}
		else {
			if (this.ThrouthContext === true) {// сквозной контекст
				this.nextTask_.ThrouthContext = true;
				this.nextTask_.Context = this.Context;
			}
			if (this.ThrouthTimeout === true) {// сквозной таймаут
				this.nextTask_.ThrouthTimeout = true;
				this.nextTask_.SetTimeout(this.timeout_);
			}
			this.nextTask_.Run.apply(this.nextTask_, [this.awaiting_].concat(lArgs));
		}
	}
	this.awaiting_ = null;
	this.nextTask_ = null;
}
Task.prototype.Run = function (runArg) {
	if (this.state_ === Task.TaskState.Completed)
		throw new Error('The task can not be started because it already completed.');

	if (typeof runArg == 'function')
		this.awaiting_ = runArg;
	else if (typeof runArg == 'number')
		this.SetTimeout(runArg);
	
	this.Context.task = this;
	
	var lArgs = Array.prototype.slice.call(arguments, 1, arguments.length);
	var lArguments = [ this.Context ].concat(Array.prototype.slice.call(this.taskArgs_, 0, this.taskArgs_.length)).concat(lArgs);
	try {
		this.state_ = Task.TaskState.Runing;
		if (this.timeout_ !== undefined && this.timeout_ != null && 
			typeof this.timeout_ == 'number' && this.timeout_ > 0) {
		    var lTimeoutHandler = (function() {
		        if (this.state_ === Task.TaskState.Completed) return;
		        if (this.state_ === Task.TaskState.Runing) {
		            this.state_ = Task.TaskState.TimeIsOut;
		        }
		    }).bind(this);
				this.timeoutObject_ = setTimeout(lTimeoutHandler, this.timeout_ + 3);// 3 - погрешность от исполнения набора операций (времени затраченном на них) (подбиралось экспериментально)
		}
		this.thisTaskFn_.apply(this, lArguments);
	}
	catch (error) {
		this.state_ = Task.TaskState.Faulted;
		this.Next(error);
	}
	finally {
		return this;
	}
}
Task.prototype.Continue = function (nextTask) {
	if (nextTask == null || nextTask === undefined) return this;

	var lNewNextTask = null;
	if (typeof nextTask == 'function') {
		lNewNextTask = new Task(nextTask, this.awaiting_);
		Array.prototype.push.apply(lNewNextTask.Args, Array.prototype.slice.call(arguments, 1, arguments.length));
	}
	else if (nextTask instanceof Task)
		lNewNextTask = nextTask;

	var lOldNextTask = null;
	if (this.nextTask_ != null && this.nextTask_ !== undefined) {
		 lOldNextTask = this.nextTask_;
	}
	
	this.nextTask_ = lNewNextTask;
	this.nextTask_.Continue(lOldNextTask);

	return this.nextTask_;
}
Task.prototype.AwaitingEnd = function (awaitFn, throuth) {
	this.awaiting_ = awaitFn;
	if (throuth) {
		var lTask = this.nextTask_;
		while (lTask !== undefined && lTask != null) {
			lTask = lTask.NextTask;
			lTask.AwaitingEnd(this.awaiting_);
		}
	}
}

Task.Chain = function (tasks, awaiting) {
	var lFirstTask = null;
	var lCurrTask = null;
	for (var task in tasks) {
		if (typeof task == 'function') {
			lCurrTask = new Task(task);
		}
		else if (task instanceof Task) {
			lCurrTask = task;
		}
		
		if (lFirstTask == null) {
			lFirstTask = lCurrTask;
			lFirstTask.AwaitingEnd(awaiting);
		}
		lCurrTask = lCurrTask.Continue(task);
	}
	return lFirstTask;
}
Task.Run = function (tasks, awaiting, timeout, throuthTimeout){
	var lFirstTask = Task.Chain(tasks, awaiting);
	lFirstTask.ThrouthTimeout = throuthTimeout;
	lFirstTask.Run(timeout);
}

function TaskState() { }
TaskState.prototype = {
	get Runing(){ return 1; },
	get Faulted(){ return 2; },
	get Failed() { return 3; },
	get Completed(){ return 4; },
	get TimeIsOut() { return 5; }
}

function TaskTimeoutError(description, timeout){
	Error.call(this);
	this.name = "TaskTimeoutError";
	this.timeout_ = timeout;
	this.message = "Task timeout expired.";
	this.description_ = description;

	if (Error.captureStackTrace) {
		Error.captureStackTrace(this, TaskTimeoutError);
	} else {
		this.stack = (new Error()).stack;
	}
}
TaskTimeoutError.prototype = Object.create(Error.prototype);
TaskTimeoutError.prototype = {
	get ExpiredTimeout(){
		return this.timeout_;
	},
	get Description(){
		return this.description_;
	}
}
Task.TaskState = new TaskState();

module.exports = function (){
	this.Task = Task;
	this.TaskTimeoutError = TaskTimeoutError;
}