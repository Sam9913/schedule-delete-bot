const axios = require('axios')
const express = require('express')
const app = express()
// Parse JSON bodies
app.use(express.json())

const glitch_url = axios.create({
    baseURL: `${process.env.glitchUrl}`
});

app.post('/wakeUp', async (req, res) => {
    try {
        await glitch_url.get();
    } catch (e) {
        res.send({ isSuccess: false, details: e.message });
    } finally {
        res.send({ isSuccess: true });
    }
});

app.listen(process.env.PORT || 3000)