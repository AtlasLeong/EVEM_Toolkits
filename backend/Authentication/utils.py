def jwt_response_payload_handler(token, user=None, ):
    return {
        'token': token,
        'user': {
            'id': user.id,
            'username': user.username
        }
    }