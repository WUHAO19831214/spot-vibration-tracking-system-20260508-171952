# 示例目录

本目录保存数据格式示例，不代表正式验证结果。

- `sample_sweep_data.csv` 是用于展示频率—光斑位移范围曲线的合成数据。
- 示例不能作为系统准确度、共振频率或教学效果证据。
- 正式实验应同时归档装置照片、标定截图、摄像头信息、原始视频、扫频参数和重复测量。

推荐字段：

```text
index,frequency_hz,spot_displacement_range_cm,elapsed_time_s,data_status
```

`spot_displacement_range_cm` 对应 `Δy_cm`，即光斑纵坐标峰—峰范围。
