
Planning Document
=================

This document contains various thoughts that are going into the planning of
Taskman.

Taskman will be split into two separate processes, frontend and baackend.

The frontend will obviously be in charge of interacting with the user in some
manner (up to the frontend implementation to design the interface).

The backend will:
- Maintain handles to active subprocess tasks running
- Maintain the "official" DAG
- Schedule tasks


In order to maintain this split and allow backend and frontend freedom of
implementation, we will define a strict API here. Before we do so though, we
will first need a general description of the common state between both
frontend and backend.



Taskman Core APIs
=================

Taskman is probably best understood through the api's it offers and the
format used when talking about its internal state via HTTP endpoints. Here
we discuss those.

DAG format
----------

The DAG will have a standard format when transferred via external APIs.
As a complete object the DAG may look as follows::

    {
        "root": "/",
        "id": "/",
        "version": "1",
        "nodes": [
            {
                "id": "123",
                "version": "1"
                "type": "command",
                "status": "complete",
                "data": {
                    "command": "echo hello world"
                    "details": {
                        "result": "0"
                        "stdout": "hello world\n",
                        "stderr": "",
                    }
                }
            }
        ]
    }

Each node in the DAG must contain:

- "id" str field - a unique ID, provided automatically by the server when
  nodes are created by a client

- "version" str field - this is the version number for the node. Every time
  the node's posiiton in the DAG or data in the node changes it will be
  increased by the server.
  This design reduces the ability for multiple clients to modify the DAG at
  the same time, but it prevents the `ABA` problem
  (https://en.wikipedia.org/wiki/ABA_problem).

- "type" str field - this is the type of the node and will determine other
  expected fields and their meaning as the backend understands them

- "status" str field - this is the current status of the node in the scheduler
  queue

Partial DAGS
~~~~~~~~~~~~

A partial DAG can be formatted by using a different root. Using the DAG from
above we can create a child node by submitting the following using a POST.
(See below for the API.) The POST will contain the following::

    {
        "root": "/123",
        "version": "1",
        "nodes": [
            {
                "id": "",
                "version": "0",
                "type": "command",
                "data" : {
                    "command": "echo goodbye world"
                }
            }
        ]
    }


When merged together by the backend, the complete DAG will look as follows::

    {
        "root": "/",
        "version": "3"
        "nodes": [
            {
                "id": "123",
                "version": "1"
                "type": "command",
                "data": {
                    "command": "echo hello world"
                }
                "children": {
                    "id": "124",
                    "version": "1",
                    "type": "command",
                    "data" : {
                        "command": "echo goodbye world"
                    }
                }
            }
        ]
    }

Note that the id number submitted in the request was an empty string and the
version zero.

Backend
-------


The frontend is going to want to:

- Query the Backend for DAG heirarchy - (This could be pagenated, won't be
  for now)
- (Un/)Subscribe for updates - NOTE non-RESTful, will need to use a pubsub
  service.
- Modify existing tasks (e.g. change command args)
- Add and Remove nodes/chains from the DAG

- Get currently running tasks.
- Kill currently running tasks.


API Endpoints
-------------

POSTs
~~~~~

/taskman/v1/dag/update

Send a complete or partial DAG to the server, this will update the existing DAG
on server side.

Parameters:

- None
- Supplied data will be interpreted as the DAG

-----

/taskman/v1/scheduler/killTask

Kill a given task.

Returns:

- Returns nothing, the POST request will return when the process terminates.

Parameters:

- id - the id of the node which task should be killed
- Additional parameters will be passed to the task's kill handler

GETs
~~~~

/taskman/v1/dag/get

Returns:

- Returns a json string with the DAG

Parameters:

- root - id of the root to return the dag from (returns full, if not supplied)
- type - a list of the type of nodes to display, can be supplied multiple times
- status - a list of status values to filter nodes on

-----

d


Taskman's Scheduler
===================


Taskman at its core is just a task scheduler. It contains a heirarchy of tasks
to run and runs them in order as soon as there are no impeding tasks further
up the heirarchy preventing them from running. (This enables certain
non-traditonal tasks such as system conditions, if/else statemnts to modify or
conditonally delay execution of tasks.)


The task scheduler maintains a list of top level tasks which have not yet
completed. The scheduler spins in a loop waiting for any task in this list to
either complete or become schedulable. If a task completes, that completed
task will be taken off the queue and any direct children will be placed in
the top level list. If a task becomes scheduleable, (e.g. a new task is added
to the top level list) then the scheduler will start the task using a
separate thread, mark the task as running, and then the scheduler will
continue through the list.

Here's psuedocode of this process::

    while True:
        for task in unscheduled_list:
            if task.status == 'complete':
                cleanup_task_thread(task)
                # psuedocode, iteration modification danger
                unscheduled_list.remove(task)
                unscheduled_list.extend(task.subtasks)

            if schedulable(task.status):
                start_task_thread(task)


NOTE: Each task should get modification access to its parent task and its
subtasks.
