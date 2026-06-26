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
    const reviewCollection = db.collection("reviews");

    // stats api
    app.get("/api/client-dashboard-stats", async (req, res) => {
      const clientEmail = req.query.clientEmail;
      const [taskStats, paymentStats] = await Promise.all([
        taskCollection
          .aggregate([
            {
              $match: { clientEmail },
            },
            {
              $group: {
                _id: null,
                totalTasks: { $sum: 1 },

                openTasks: {
                  $sum: {
                    $cond: [{ $eq: ["$status", "open"] }, 1, 0],
                  },
                },

                inProgressTasks: {
                  $sum: {
                    $cond: [{ $eq: ["$status", "in-progress"] }, 1, 0],
                  },
                },
              },
            },
          ])
          .toArray(),

        paymentCollection
          .aggregate([
            {
              $match: {
                clientEmail,
                payment_status: "paid",
              },
            },
            {
              $group: {
                _id: null,
                totalSpent: {
                  $sum: {
                    $toDouble: "$amount",
                  },
                },
              },
            },
          ])
          .toArray(),
      ]);
      res.send({
        totalTasks: taskStats[0]?.totalTasks || 0,
        openTasks: taskStats[0]?.openTasks || 0,
        inProgressTasks: taskStats[0]?.inProgressTasks || 0,
        totalSpent: paymentStats[0]?.totalSpent || 0,
      });
    });
    app.get("/api/monthly-growth/:clientId", async (req, res) => {
      const { clientId } = req.params;
      const now = new Date();
      const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
      const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      const result = await taskCollection
        .aggregate([
          {
            $match: {
              clientId,
              status: "completed",
              createdAt: {
                $gte: firstDay,
                $lt: lastDay,
              },
            },
          },

          {
            $lookup: {
              from: "payments",
              let: {
                taskId: { $toString: "$_id" },
              },
              pipeline: [
                {
                  $match: {
                    $expr: {
                      $eq: ["$taskId", "$$taskId"],
                    },
                  },
                },
              ],
              as: "payment",
            },
          },

          {
            $unwind: "$payment",
          },

          {
            $group: {
              _id: "$category",

              completedTasks: {
                $sum: 1,
              },

              totalBudget: {
                $sum: {
                  $toDouble: "$payment.amount",
                },
              },
            },
          },

          {
            $project: {
              _id: 0,
              category: "$_id",
              completedTasks: 1,
              totalBudget: 1,
            },
          },

          {
            $sort: {
              totalBudget: -1,
            },
          },
        ])
        .toArray();
      res.json(result);
    });
    app.get("/api/freelancer-overview/:email", async (req, res) => {
      try {
        const { email } = req.params;

        const now = new Date();

        const firstDayOfThreeMonthsAgo = new Date(
          now.getFullYear(),
          now.getMonth() - 2,
          1,
        );

        const [proposalStats, paymentStats, runningProjects, monthlyEarnings] =
          await Promise.all([
           
            // Proposal Statistics
            proposalCollection
              .aggregate([
                {
                  $match: {
                    freelancerEmail: email,
                  },
                },
                {
                  $group: {
                    _id: null,

                    totalProposals: {
                      $sum: 1,
                    },

                    pendingProposals: {
                      $sum: {
                        $cond: [{ $eq: ["$status", "pending"] }, 1, 0],
                      },
                    },

                    acceptedProposals: {
                      $sum: {
                        $cond: [{ $eq: ["$status", "accepted"] }, 1, 0],
                      },
                    },
                  },
                },
              ])
              .toArray(),

            // Total Earnings
            paymentCollection
              .aggregate([
                {
                  $match: {
                    freelancerEmail: email,
                    payment_status: "paid",
                  },
                },
                {
                  $group: {
                    _id: null,

                    totalEarnings: {
                      $sum: {
                        $toDouble: "$amount",
                      },
                    },
                  },
                },
              ])
              .toArray(),

            // Running Projects
            proposalCollection
              .aggregate([
                {
                  $match: {
                    freelancerEmail: email,
                    status: "accepted",
                  },
                },

                {
                  $lookup: {
                    from: "tasks",

                    let: {
                      taskId: {
                        $toObjectId: "$taskId",
                      },
                    },

                    pipeline: [
                      {
                        $match: {
                          $expr: {
                            $eq: ["$_id", "$$taskId"],
                          },
                        },
                      },

                      {
                        $match: {
                          status: "in-progress",
                        },
                      },

                      {
                        $project: {
                          title: 1,
                          category: 1,
                          deadline: 1,
                          budget: 1,
                          clientEmail: 1,
                        },
                      },
                    ],

                    as: "task",
                  },
                },

                {
                  $unwind: "$task",
                },

                {
                  $replaceRoot: {
                    newRoot: "$task",
                  },
                },
              ])
              .toArray(),

            // Last 3 Months Earnings

            paymentCollection
              .aggregate([
                {
                  $match: {
                    freelancerEmail: email,
                    payment_status: "paid",
                    payedAt: {
                      $gte: firstDayOfThreeMonthsAgo,
                    },
                  },
                },

                {
                  $group: {
                    _id: {
                      year: {
                        $year: "$payedAt",
                      },
                      month: {
                        $month: "$payedAt",
                      },
                    },

                    earning: {
                      $sum: {
                        $toDouble: "$amount",
                      },
                    },
                  },
                },

                {
                  $sort: {
                    "_id.year": 1,
                    "_id.month": 1,
                  },
                },

                {
                  $project: {
                    _id: 0,
                    year: "$_id.year",
                    month: "$_id.month",
                    earning: 1,
                  },
                },
              ])
              .toArray(),
          ]);

        const stats = {
          totalProposals: proposalStats[0]?.totalProposals || 0,
          pendingProposals: proposalStats[0]?.pendingProposals || 0,
          acceptedProposals: proposalStats[0]?.acceptedProposals || 0,
          totalEarnings: paymentStats[0]?.totalEarnings || 0,
        };

        res.send({
          stats,
          runningProjects,
          monthlyEarnings,
        });
      } catch (error) {
        console.error(error);
        res.status(500).send({
          message: "Internal Server Error",
        });
      }
    });
    // User Related Api
    app.get("/api/user/:id", async (req, res) => {
      const userId = req.params.id;
      const result = await userCollection.findOne({
        _id: new ObjectId(userId),
      });
      res.json(result);
    });
    app.patch("/api/update/user/:id", async (req, res) => {
      const userId = req.params.id;
      const updatedUserData = req.body;
      const result = await userCollection.updateOne(
        {
          _id: new ObjectId(userId),
        },
        {
          $set: updatedUserData,
        },
      );
      res.json(result);
    });
    app.get("/api/freelancerProfile", async (req, res) => {
      const freelancerEmail = req.query.freelancerEmail;
      const result = await userCollection.findOne({
        email: freelancerEmail,
      });
      res.json(result);
    });
    app.get("/api/all/freelancer", async (req, res) => {
      const result = await userCollection
        .find({
          role: "Freelancer",
        })
        .toArray();
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
      res.json(result);
    });
    app.delete("/api/delete/task/:id", async (req, res) => {
      const taskId = req.params.id;
      const result = await taskCollection.deleteOne({
        _id: new ObjectId(taskId),
      });
      res.json(result);
    });
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
    app.delete("/api/delete/proposal/:id", async (req, res) => {
      const proposalId = req.params.id;
      const result = await proposalCollection.deleteOne({
        _id: new ObjectId(proposalId),
      });
      console.log("result", result);
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
    app.get("/api/active/projects", async (req, res) => {
      const freelancerEmail = req.query.freelancerEmail;
      const result = await proposalCollection
        .aggregate([
          {
            $match: {
              freelancerEmail: freelancerEmail,
            },
          },
          {
            $addFields: {
              taskObjId: {
                $toObjectId: "$taskId",
              },
            },
          },
          {
            $lookup: {
              from: "tasks",
              localField: "taskObjId",
              foreignField: "_id",
              as: "tasks",
            },
          },
          {
            $unwind: "$tasks",
          },
          {
            $match: {
              "tasks.status": { $ne: "open" },
            },
          },
        ])
        .toArray();
      res.json(result);
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
    app.get("/api/freelancer/earnings/:email", async (req, res) => {
      try {
        const freelancerEmail = req.params.email;
        // Aggregation Pipeline to join payment, tasks, and users collections
        const earningsBreakdown = await paymentCollection
          .aggregate([
            {
              $match: {
                freelancerEmail: freelancerEmail,
                payment_status: "paid",
              },
            },
            {
              $addFields: { taskIdObj: { $toObjectId: "$taskId" } },
            },
            {
              $lookup: {
                from: "tasks",
                localField: "taskIdObj",
                foreignField: "_id",
                as: "taskInfo",
              },
            },
            {
              $unwind: "$taskInfo",
            },
            {
              $lookup: {
                from: "user",
                localField: "clientEmail",
                foreignField: "email",
                as: "clientInfo",
              },
            },
            {
              $unwind: "$clientInfo",
            },
            {
              $project: {
                _id: 1,
                amount: 1,
                transaction_id: 1,
                payedAt: 1,
                taskTitle: { $ifNull: ["$taskInfo.title", "Deleted Project"] },
                clientName: { $ifNull: ["$clientInfo.name", "Unknown Client"] },
              },
            },
            {
              $sort: { payedAt: -1 },
            },
          ])
          .toArray();

        // মোট উপার্জিত টাকার পরিমাণ হিসাব করা (Total Earnings Card এর জন্য)
        const totalStats = await paymentCollection
          .aggregate([
            {
              $match: {
                freelancerEmail: freelancerEmail,
                payment_status: "paid",
              },
            },
            {
              $group: {
                _id: null,
                total: { $sum: { $toDouble: "$amount" } },
              },
            },
          ])
          .toArray();

        const totalMade = totalStats.length > 0 ? totalStats[0].total : 0;

        res.json({
          success: true,
          totalEarnings: totalMade,
          data: earningsBreakdown,
        });
      } catch (error) {
        res.status(500).json({ success: false, message: error.message });
      }
    });
    // Review Related Api
    app.post("/api/save/review", async (req, res) => {
      try {
        const data = req.body;
        const reviewData = {
          ...data,
          reviewedAt: new Date(),
        };
        const result = await reviewCollection.insertOne(reviewData);
        const freelancerEmail = data.reviewee_email;
        const freelancer = await userCollection.findOne({
          email: freelancerEmail,
        });

        if (freelancer) {
          const currentTotalReviews = freelancer?.totalReviews || 0;
          const currentAverageRating = freelancer?.averageRating || 0;

          const newTotalReviews = currentTotalReviews + 1;

          const calculatedAverage =
            (currentAverageRating * currentTotalReviews + Number(data.rating)) /
            newTotalReviews;
          const newAverageRating = parseFloat(calculatedAverage.toFixed(1));
          await userCollection.updateOne(
            { email: freelancerEmail },
            {
              $set: {
                averageRating: newAverageRating,
                totalReviews: newTotalReviews,
              },
            },
          );
        }
        res.json(result);
      } catch (error) {
        res.status(500).json({
          success: false,
          message: "Internal Server Error",
          error: error.message,
        });
      }
    });
    app.get("/reviews", async (req, res) => {
      const result = await reviewCollection.find().toArray();
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
