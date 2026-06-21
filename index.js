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
    const proposalCollection=db.collection("proposals");
    app.get("/user", async (req, res) => {
      const result = await userCollection.find().toArray();
      res.json(result);
    });

    0;
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

    app.get("/api/tasks", async (req, res) => {
      const query = {};
      if (req.query.clientId) {
        query.clientId = req.query.clientId;
        const result = await taskCollection.find(query).toArray();
        res.json(result);
      }
      const tasks = await taskCollection
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
      const task =await taskCollection
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
        ]).toArray()
        // console.log(task)
      res.json(task[0]);
    });

    // Proposal Related Api
    app.post("/api/post/proposal",async(req,res)=>{
      const data=req.body;
      const proposalData={
        ...data,
        submittedAt:new Date()
      }
      const result=await proposalCollection.insertOne(proposalData)
      res.json(result)
    })

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
