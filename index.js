const express = require("express");
const dotenv = require("dotenv");
const app = express();
const cors = require("cors");
dotenv.config();
const PORT = process.env.PORT || 8000;
app.use(cors());
app.use(express.json());

const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const uri = process.env.MONGO_DB_URI;
// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    await client.connect();
    const db = await client.db("TaskForgeDB");
    const taskCollection = db.collection("tasks");
    const userCollection = db.collection("user");
    const proposalCollection = db.collection("proposals");
    const paymentCollection = db.collection("payments");
    app.get("/user", async (req, res) => {
      const result = await userCollection.find().toArray();
      res.json(result);
    });

    // User Related Api
    app.get("/api/freelancerProfile", async (req, res) => {
      const freelancerEmail = req.query.freelancerEmail;
      const result = await userCollection.findOne({
        email: freelancerEmail,
      });
      res.json(result);
    });
    // Tasks Related Api
    app.post("/api/create/task", async (req, res) => {
      const data = req.body;
      const taskData = {
        ...data,
        createdAt: new Date(),
      };
      const result = await taskCollection.insertOne(taskData);
      res.json(result);
    });

    app.patch("/api/update/task/:id", async (req, res) => {
      const taskId = req.params.id;
      const updatedFields = req.body;
      const result = await taskCollection.updateOne(
        { _id: new ObjectId(taskId) },
        { $set: updatedFields },
      );
      res.json(result)
    });
    app.delete("/api/delete/task/:id",async(req,res)=>{
      const taskId = req.params.id;
      const result = await taskCollection.deleteOne(
        { _id: new ObjectId(taskId) },
      );
      res.json(result)
    })
    app.get("/api/tasks", async (req, res) => {
      const query = {};
      if (req.query.clientId) {
        // for specific client task
        query.clientId = req.query.clientId;
        const result = await taskCollection
          .aggregate([
            {
              $match: {
                clientId: query.clientId,
              },
            },
            {
              $sort: {
                createdAt: -1,
              },
            },
            {
              $lookup: {
                from: "proposals",
                let: {
                  taskId: "$_id",
                },
                pipeline: [
                  {
                    $match: {
                      $expr: {
                        $eq: [{ $toObjectId: "$taskId" }, "$$taskId"],
                      },
                    },
                  },
                ],
                as: "proposal",
              },
            },
            {
              $addFields: {
                proposalCount: {
                  $size: "$proposal",
                },
              },
            },
            {
              $project: {
                proposal: 0,
              },
            },
          ])
          .toArray();
        res.json(result);
      }
      const tasks = await taskCollection //for get all task in the browse task page
        .aggregate([
          {
            $lookup: {
              from: "user",
              let: {
                clientIdObj: {
                  $toObjectId: "$clientId",
                },
              },
              pipeline: [
                {
                  $match: {
                    $expr: {
                      $eq: ["$_id", "$$clientIdObj"],
                    },
                  },
                },
              ],
              as: "client",
            },
          },
          {
            $unwind: "$client",
          },
          {
            $addFields: {
              clientName: "$client.name",
            },
          },
          {
            $project: {
              client: 0,
            },
          },
          {
            $match: {
              status: "open",
            },
          },
        ])
        .toArray();
      res.json(tasks);
    });

    app.get("/api/taskDetails/:id", async (req, res) => {
      const { id } = req.params;
      const task = await taskCollection
        .aggregate([
          {
            $match: { _id: new ObjectId(id) },
          },
          {
            $lookup: {
              from: "user",
              let: {
                clientIdObj: {
                  $toObjectId: "$clientId",
                },
              },
              pipeline: [
                {
                  $match: {
                    $expr: {
                      $eq: ["$_id", "$$clientIdObj"],
                    },
                  },
                },
              ],
              as: "client",
            },
          },
          {
            $unwind: "$client",
          },
          {
            $lookup: {
              from: "tasks",
              let: {
                clientId: "$clientId",
              },
              pipeline: [
                {
                  $match: {
                    $expr: {
                      $eq: ["$clientId", "$$clientId"],
                    },
                  },
                },
                {
                  $count: "total",
                },
              ],
              as: "postedJobs",
            },
          },
          {
            $lookup: {
              from: "proposals",
              let: {
                taskId: "$_id",
              },
              pipeline: [
                {
                  $match: {
                    $expr: {
                      $eq: [{ $toObjectId: "$taskId" }, "$$taskId"],
                    },
                  },
                },
              ],
              as: "proposals",
            },
          },
          {
            $addFields: {
              clientName: "$client.name",
              clientImage: "$client.image",
              clientCreatedAt: "$client.createdAt",
              clientPostedJobs: {
                $ifNull: [{ $arrayElemAt: ["$postedJobs.total", 0] }, 0],
              },
            },
          },
          {
            $project: {
              client: 0,
              postedJobs: 0,
            },
          },
        ])
        .toArray();
      res.json(task[0]);
    });

    // Proposal Related Api
    app.post("/api/post/proposal", async (req, res) => {
      const data = req.body;
      const proposalData = {
        ...data,
        submittedAt: new Date(),
      };
      const result = await proposalCollection.insertOne(proposalData);
      res.json(result);
    });
    app.patch("/api/update/proposal", async (req, res) => {
      const { status } = req.body;
      const proposalId = req.query.proposalId;
      const result = await proposalCollection.updateOne(
        {
          _id: new ObjectId(proposalId),
        },
        {
          $set: {
            status: status,
          },
        },
      );
      res.json(result);
    });
    app.get("/api/proposal", async (req, res) => {
      const query = {};
      if (req.query.taskId && req.query.freelancerEmail) {
        query.taskId = req.query.taskId;
        query.freelancerEmail = req.query.freelancerEmail;
        const proposal = await proposalCollection.findOne({
          $and: [
            { taskId: query.taskId },
            { freelancerEmail: query.freelancerEmail },
          ],
        });
        res.json(proposal);
      }
      const proposal = await proposalCollection.find().toArray();
      res.json(proposal);
    });
    app.get("/api/proposalById", async (req, res) => {
      const proposalId = req.query.proposalId;
      const proposal = await proposalCollection
        .aggregate([
          {
            $match: {
              _id: new ObjectId(proposalId),
            },
          },
          {
            $lookup: {
              from: "user",
              localField: "freelancerEmail",
              foreignField: "email",
              as: "freelancer",
            },
          },
          {
            $unwind: "$freelancer",
          },
          {
            $addFields: {
              freelancerName: "$freelancer.name",
            },
          },
          {
            $project: {
              freelancer: 0,
            },
          },
        ])
        .toArray();
      res.json(proposal[0]);
    });
    app.get("/api/freelancer/proposals", async (req, res) => {
      const freelancerEmail = req.query.freelancerEmail;
      const proposals = await proposalCollection
        .find({
          freelancerEmail: freelancerEmail,
        })
        .toArray();
      res.json(proposals);
    });
    app.get("/api/client/proposals", async (req, res) => {
      const proposals = await proposalCollection
        .aggregate([
          {
            $lookup: {
              from: "tasks",
              let: {
                taskId: "$_id",
              },
              pipeline: [
                {
                  $match: {
                    $expr: {
                      $eq: [{ $toObjectId: "$taskId" }, "$$taskId"],
                    },
                  },
                },
              ],
              as: "tasks",
            },
          },
          {
            $project: {
              tasks: 0,
            },
          },
          {
            $match: {
              status: { $ne: "rejected" },
            },
          },
          {
            $sort: {
              submittedAt: -1,
            },
          },
        ])
        .toArray();
      res.json(proposals);
    });

    // Payment Related Api
    app.post("/api/save/payment", async (req, res) => {
      const data = req.body;
      const paymentData = {
        ...data,
        payedAt: new Date(),
      };
      const result = await paymentCollection.insertOne(paymentData);

      //update payed proposal, pending to accepted
      await proposalCollection.updateOne(
        {
          _id: new ObjectId(data?.proposalId),
        },
        {
          $set: {
            status: "accepted",
          },
        },
      );
      // Rejected others proposal
      await proposalCollection.updateMany(
        {
          taskId: data?.taskId,
          _id: { $ne: new ObjectId(data?.proposalId) },
        },
        {
          $set: {
            status: "rejected",
          },
        },
      );
      // update task status to in-progress
      await taskCollection.updateOne(
        {
          _id: new ObjectId(data?.taskId),
        },
        {
          $set: {
            status: "In-progress",
          },
        },
      );
      res.json(result);
    });
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!",
    );
  } finally {
    // await client.close()
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Hello world");
});

app.listen(PORT, () => {
  console.log(`Example APP Running on port ${PORT}`);
});
