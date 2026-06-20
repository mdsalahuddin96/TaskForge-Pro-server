const express=require('express')
const dotenv=require("dotenv")
const cors=require("cors");
const PORT=process.env.PORT||8000
dotenv.config();
const app=express()
app.use(cors())
app.get("/",(req,res)=>{
    res.send("Hello world")
})

app.listen(PORT,()=>{
    console.log(`Example APP Running on port ${PORT}`)
})