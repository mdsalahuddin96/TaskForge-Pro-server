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
    const sessionCollection = db.collection("session");
    // Verification Related
    const verifyToken = async (req, res, next) => {
      const authHeaders = req.headers?.authorization;
      const token = authHeaders.split(" ")[1];
      if (!authHeaders) {
        res.status(401).send({ message: "Unauthorized access" });
      }
      if (!token) {
        res.status(401).send({ message: "Unauthorized access" });
      }
      const session = await sessionCollection.findOne({
        token: token,
      });
      const userId = session?.userId;
      const user = await userCollection.findOne({ _id: userId });
      req.user = user;
      // console.log("user", user);
      next();
    };
    const verifyClient = async (req, res, next) => {
      const user = req.user;
      if (!user.role === "Client") {
        return res.status(403).send({ message: "Forbidden user" });
      }
      next();
    };
    const verifyFreelancer = async (req, res, next) => {
      const user = req.user;
      if (user.role !== "Freelancer") {
        return res.status(403).send({ message: "Forbidden user" });
      }
      next();
    };
    const verifyAdmin = async (req, res, next) => {
      const user = req.user;
      if (user.role.toLowerCase() !== "admin") {
        return res.status(403).send({ message: "Forbidden user" });
      }
      next();
    };
    // stats api
    app.get(
      "/api/client-dashboard-stats",
      verifyToken,
      verifyClient,
      async (req, res) => {
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
      },
    );
    app.get(
      "/api/monthly-growth/:clientId",
      verifyToken,
      verifyClient,
      async (req, res) => {
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
      },
    );
    app.get(
      "/api/freelancer-overview/:email",
      verifyToken,
      verifyFreelancer,
      async (req, res) => {
        try {
          const { email } = req.params;

          const now = new Date();

          const firstDayOfThreeMonthsAgo = new Date(
            now.getFullYear(),
            now.getMonth() - 2,
            1,
          );

          const [
            proposalStats,
            paymentStats,
            runningProjects,
            monthlyEarnings,
          ] = await Promise.all([
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
      },
    );
    app.get("/api/admin/overview", verifyToken,verifyAdmin, async (req, res) => {
      try {
        const today = new Date();
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(today.getDate() - 6);
        sevenDaysAgo.setHours(0, 0, 0, 0);
        const [
          totalUsers,
          totalTasks,
          activeTasks,
          revenue,
          categoryData,
          paymentTrend,
          userTrend,
        ] = await Promise.all([
          // Total Users
          userCollection.countDocuments(),

          // Total Tasks
          taskCollection.countDocuments(),

          // Active Tasks
          taskCollection.countDocuments({
            status: { $ne: "completed" },
          }),

          // Total Revenue
          paymentCollection
            .aggregate([
              {
                $match: {
                  payment_status: "paid",
                },
              },
              {
                $group: {
                  _id: null,
                  totalRevenue: {
                    $sum: {
                      $toDouble: "$amount",
                    },
                  },
                },
              },
            ])
            .toArray(),

          // Category Distribution
          taskCollection
            .aggregate([
              {
                $group: {
                  _id: "$category",
                  value: {
                    $sum: 1,
                  },
                },
              },
              {
                $project: {
                  _id: 0,
                  name: "$_id",
                  value: 1,
                },
              },
            ])
            .toArray(),

          // Last 7 Days Revenue
          paymentCollection
            .aggregate([
              {
                $match: {
                  payment_status: "paid",
                  payedAt: {
                    $gte: sevenDaysAgo,
                  },
                },
              },
              {
                $group: {
                  _id: {
                    $dateToString: {
                      format: "%Y-%m-%d",
                      date: "$payedAt",
                    },
                  },

                  revenue: {
                    $sum: {
                      $toDouble: "$amount",
                    },
                  },
                },
              },
            ])
            .toArray(),

          // Last 7 Days Registration
          userCollection
            .aggregate([
              {
                $match: {
                  createdAt: {
                    $gte: sevenDaysAgo,
                  },
                },
              },
              {
                $group: {
                  _id: {
                    $dateToString: {
                      format: "%Y-%m-%d",
                      date: "$createdAt",
                    },
                  },

                  users: {
                    $sum: 1,
                  },
                },
              },
            ])
            .toArray(),
        ]);

        // ===========================
        // Merge Trend Data
        // ===========================

        const trendData = [];

        for (let i = 6; i >= 0; i--) {
          const date = new Date();

          date.setDate(today.getDate() - i);

          const key = date.toISOString().split("T")[0];

          trendData.push({
            date: key,
            revenue:
              paymentTrend.find((item) => item._id === key)?.revenue || 0,

            users: userTrend.find((item) => item._id === key)?.users || 0,
          });
        }

        res.json({
          stats: {
            totalUsers,
            totalTasks,
            activeTasks,
            totalRevenue: revenue[0]?.totalRevenue || 0,
          },

          categoryData,

          trendData,
        });
      } catch (error) {
        console.log(error);

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
    app.patch("/api/update/user/:id", verifyToken, async (req, res) => {
      const userId = req.params.id;
      const updatedUserData = req.body;
      const id = req.user?._id.toString();
      if (id !== userId) {
        return res.status(403).json({
          message: "Forbidden",
        });
      }
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
    app.get("/api/all/users", async (req, res) => {
      const result = await userCollection.find().toArray();
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
    app.post(
      "/api/create/task",
      verifyToken,
      verifyClient,
      async (req, res) => {
        const data = req.body;
        const taskData = {
          ...data,
          createdAt: new Date(),
        };
        const result = await taskCollection.insertOne(taskData);
        res.json(result);
      },
    );
    app.patch(
      "/api/update/task/:id",
      verifyToken,
      verifyClient,
      async (req, res) => {
        const taskId = req.params.id;
        const updatedFields = req.body;
        const result = await taskCollection.updateOne(
          { _id: new ObjectId(taskId) },
          { $set: updatedFields },
        );
        res.json(result);
      },
    );
    app.delete(
      "/api/delete/task/:id",
      verifyToken,
      async (req, res) => {
        const taskId = req.params.id;
        const result = await taskCollection.deleteOne({
          _id: new ObjectId(taskId),
        });
        res.json(result);
      },
    );
    app.get("/api/tasks",verifyToken, async (req, res) => {
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
        return res.json(result);
      }
      const allTasks = await taskCollection //for get all task in the admin task management page
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
            $sort: { createdAt: -1 },
          },
        ])
        .toArray();
      res.json({ allTasks });
    });
    app.get("/api/browse-tasks", async (req, res) => {
      try {
        const { search, category, budget } = req.query;

        const match = {
          status: "open",
        };

        // Search by title
        if (search) {
          match.title = {
            $regex: search,
            $options: "i",
          };
        }

        // Category Filter
        if (category && category !== "All Category") {
          match.category = {
            $regex: category,
            $options: "i",
          };
        }

        // Budget Filter
        if (budget) {
          switch (budget) {
            case "low":
              match.budget = { $lt: 50 };
              break;

            case "mid":
              match.budget = {
                $gte: 50,
                $lte: 200,
              };
              break;

            case "high":
              match.budget = {
                $gt: 200,
              };
              break;
          }
        }

        const tasks = await taskCollection
          .aggregate([
            {
              $match: match,
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
              $sort: {
                createdAt: -1,
              },
            },
          ])
          .toArray();

        res.send(tasks);
      } catch (err) {
        console.log(err);
        res.status(500).send({
          message: "Internal Server Error",
        });
      }
    });
    app.get("/api/featured/tasks", async (req, res) => {
      const result = await taskCollection
        .aggregate([
          {
            $match: {
              status: "open",
            },
          },
          {
            $sort: { createdAt: -1 },
          },
        ])
        .limit(6)
        .toArray();
      res.json(result);
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
    app.post(
      "/api/post/proposal",
      verifyToken,
      verifyFreelancer,
      async (req, res) => {
        const data = req.body;
        const proposalData = {
          ...data,
          submittedAt: new Date(),
        };
        const result = await proposalCollection.insertOne(proposalData);
        res.json(result);
      },
    );
    app.patch("/api/update/proposal", verifyToken, async (req, res) => {
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
    app.delete(
      "/api/delete/proposal/:id",
      verifyToken,
      verifyFreelancer,
      async (req, res) => {
        const proposalId = req.params.id;
        const result = await proposalCollection.deleteOne({
          _id: new ObjectId(proposalId),
        });
        console.log("result", result);
        res.json(result);
      },
    );
    app.get("/api/proposal", async (req, res) => { //use for checking already applied, used in browse-task page
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
        return res.json(proposal);
      }
      res.json({});
    });
    app.get(
      "/api/proposalById",
      verifyToken,
      verifyClient,
      async (req, res) => {
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
      },
    );
    app.get(
      "/api/freelancer/proposals",
      verifyToken,
      verifyFreelancer,
      async (req, res) => {
        const freelancerEmail = req.query.freelancerEmail;
        const proposals = await proposalCollection
          .find({
            freelancerEmail: freelancerEmail,
          })
          .toArray();
        res.json(proposals);
      },
    );
    app.get(
      "/api/client/proposals/:email",
      verifyToken,
      verifyClient,
      async (req, res) => {
        try {
          const { email } = req.params;
          const proposals = await taskCollection
            .aggregate([
              {
                $match: {
                  clientEmail: email,
                },
              },

              {
                $lookup: {
                  from: "proposals",
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
                    {
                      $match: {
                        status: {
                          $ne: "rejected",
                        },
                      },
                    },
                    {
                      $sort: {
                        submittedAt: -1,
                      },
                    },
                  ],
                  as: "proposals",
                },
              },

              {
                $unwind: "$proposals",
              },

              {
                $replaceRoot: {
                  newRoot: {
                    $mergeObjects: [
                      "$proposals",
                      {
                        taskTitle: "$title",
                        category: "$category",
                        budget: "$budget",
                        deadline: "$deadline",
                        taskStatus: "$status",
                        clientEmail: "$clientEmail",
                      },
                    ],
                  },
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
        } catch (err) {
          console.error(err);
          res.status(500).json({
            message: "Internal Server Error",
          });
        }
      },
    );
    app.get(
      "/api/active/projects",
      verifyToken,
      verifyFreelancer,
      async (req, res) => {
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
      },
    );

    // Payment Related Api
    app.post(
      "/api/save/payment",
      verifyToken,
      verifyClient,
      async (req, res) => {
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
      },
    );
    app.get(
      "/api/freelancer/earnings/:email",
      verifyToken,
      verifyFreelancer,
      async (req, res) => {
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
                  taskTitle: {
                    $ifNull: ["$taskInfo.title", "Deleted Project"],
                  },
                  clientName: {
                    $ifNull: ["$clientInfo.name", "Unknown Client"],
                  },
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
      },
    );
    app.get("/api/payments", verifyToken, verifyAdmin, async (req, res) => {
      const result = await paymentCollection.find().toArray();
      res.json(result);
    });
    // Review Related Api
    app.post("/api/save/review", verifyToken, verifyClient, async (req, res) => {
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
