import requests
import pymysql
import sys

# 数据库连接配置
db_config = {
    'host': 'localhost',
    'user': 'root',  # 替换为你的用户名
    'password': '123456',  # 替换为你的密码
    'db': 'eve_fetch_data',  # 数据库名
    'autocommit': True  # 确保所有更改都会立即提交到数据库
}

# EVE API的URL
EVE_API_URL = 'https://esi.evetech.net/latest/'

# 从API获取数据
def fetch_from_api(endpoint):
    response = requests.get(EVE_API_URL + endpoint)
    if response.status_code == 200:
        return response.json()
    else:
        response.raise_for_status()

# 检查并记录缺失的星系ID
def check_missing_star_systems():
    with pymysql.connect(**db_config) as connection:
        with connection.cursor(pymysql.cursors.DictCursor) as cursor:
            # 获取所有星系ID
            print("Fetching all star system IDs from API...")
            all_system_ids = fetch_from_api('universe/systems/')

            # 获取数据库中已有的星系ID
            print("Fetching existing star system IDs from database...")
            cursor.execute("SELECT system_id FROM star_systems")
            existing_system_ids = {row['system_id'] for row in cursor.fetchall()}

            # 找出缺失的星系ID
            print("Checking for missing star system IDs...")
            missing_system_ids = set(all_system_ids) - existing_system_ids
            print(missing_system_ids)

            # 记录缺失的星系ID到数据库
            for system_id in missing_system_ids:
                try:
                    # 获取星系的详细信息
                    system_data = fetch_from_api(f'universe/systems/{system_id}/')

                    # 插入缺失的星系ID到数据库
                    cursor.execute(
                        "INSERT INTO star_systems (system_id, constellation_id, name, security_class, security_status, star_id, x, y, z) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)",
                        (
                            system_id,
                            system_data['constellation_id'],
                            system_data['name'],
                            system_data.get('security_class', ''),
                            system_data['security_status'],
                            system_data.get('star_id', 0),
                            system_data['position']['x'],
                            system_data['position']['y'],
                            system_data['position']['z']
                        )
                    )
                    print(f"Recorded missing star system: {system_data['name']}")

                    # 存储星门数据
                    for stargate_id in system_data.get('stargates', []):
                        stargate_data = fetch_from_api(f'universe/stargates/{stargate_id}/')
                        cursor.execute(
                            "INSERT INTO stargates (stargate_id, system_id, name, type_id, destination_system_id, destination_stargate_id, x, y, z) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)",
                            (
                                stargate_id,
                                system_id,
                                stargate_data['name'],
                                stargate_data['type_id'],
                                stargate_data['destination']['system_id'],
                                stargate_data['destination']['stargate_id'],
                                stargate_data['position']['x'],
                                stargate_data['position']['y'],
                                stargate_data['position']['z']
                            )
                        )
                        print(f"Recorded stargate: {stargate_data['name']}")

                except Exception as e:
                    print(f"Error inserting star system ID {system_id}: {e}")


# 主函数
def main():
    try:
        check_missing_star_systems()
    except requests.HTTPError as http_err:
        print(f"HTTP error occurred: {http_err}")
    except pymysql.MySQLError as db_err:
        print(f"Database error occurred: {db_err}")
    except Exception as err:
        print(f"An error occurred: {err}")
        sys.exit(1)


if __name__ == "__main__":
    main()
